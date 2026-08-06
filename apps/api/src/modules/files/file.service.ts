import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Client as MinioClient } from 'minio'
import { FILE_UPLOAD, TTL, type FileCategory } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT } from '../../common/minio/minio.constants'
import { AppException } from '../../common/exceptions/app.exception'
import { detectAllowedFileType } from './mime-detector'

export interface UploadFileParams {
  /** Содержимое файла в памяти (только для буферной загрузки ≤ порога, docs/BACKEND_RULES.md §8). */
  buffer: Buffer
  /** Целевой бакет MinIO. */
  bucket: string
  /** Владелец файла (из JWT, не из тела запроса). */
  ownerId: string
  /** Если задано — тип по содержимому обязан попасть в эту категорию (напр. аватар → IMAGE). */
  expectedCategory?: FileCategory
  /** Привязка к заявке (Ф7): проставляется атомарно при создании записи File. */
  applicationId?: string
  /** Привязка к учебному материалу (Ф12). */
  materialId?: string
  /** Привязка к сообщению чата (Ф9+): вложение сообщения. */
  messageId?: string
}

// Поля File, безопасные для отдачи наружу (passwordHash и т.п. здесь неприменимы, но select фиксируем).
const FILE_SELECT = {
  id: true,
  bucket: true,
  key: true,
  mime: true,
  size: true,
  ownerId: true,
  applicationId: true,
  materialId: true,
  messageId: true,
  posterKey: true,
  createdAt: true,
} as const

/**
 * Работа с файлами в MinIO + метаданными в таблице File (docs/BACKEND_RULES.md §8).
 * Проверка владения/scope — на уровне контроллера (задача 2.3); здесь только примитивы,
 * переиспользуемые другими модулями (аватар 4.3, вложения заявок, медиа постов).
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {}

  /**
   * Буферная загрузка через API-процесс: тип определяется по magic bytes, размер
   * проверяется по лимиту категории, файлы больше порога отклоняются (нужен presigned).
   */
  async upload({
    buffer,
    bucket,
    ownerId,
    expectedCategory,
    applicationId,
    materialId,
    messageId,
  }: UploadFileParams) {
    const detected = await detectAllowedFileType(buffer)
    if (!detected) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'Тип файла не поддерживается или не распознан',
      )
    }
    if (expectedCategory && detected.category !== expectedCategory) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        `Ожидается файл категории ${expectedCategory}`,
      )
    }

    const size = buffer.byteLength
    const maxBytes = FILE_UPLOAD.MAX_BYTES[detected.category]
    if (size > maxBytes) {
      throw new AppException('FILE_TOO_LARGE', `Файл превышает лимит ${maxBytes} байт`)
    }
    if (size > FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES) {
      throw new AppException(
        'FILE_DIRECT_UPLOAD_REQUIRED',
        'Файл больше порога буферной загрузки — используйте presigned-загрузку напрямую в MinIO',
      )
    }

    const key = `${randomUUID()}.${detected.ext}`
    await this.minio.putObject(bucket, key, buffer, size, { 'Content-Type': detected.mime })

    const file = await this.prisma.file.create({
      data: {
        bucket,
        key,
        mime: detected.mime,
        size,
        ownerId,
        applicationId,
        materialId,
        messageId,
      },
      select: FILE_SELECT,
    })
    this.logger.log(`Загружен файл ${file.id} (${detected.mime}, ${size} байт) → ${bucket}`)
    return file
  }

  /**
   * Presigned PUT URL для прямой загрузки крупного объекта в MinIO, минуя API-процесс
   * (docs/BACKEND_RULES.md §8: файлы > порога — только presigned). Ключ генерируется здесь.
   */
  async presignPut(bucket: string, mime: string): Promise<{ key: string; url: string }> {
    const ext = (mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin'
    const key = `${randomUUID()}.${ext}`
    const url = await this.minio.presignedPutObject(bucket, key, TTL.PRESIGNED_URL_MINUTES * 60)
    return { key, url }
  }

  /**
   * Подтверждение прямой (presigned) загрузки: объект должен существовать в бакете; размер
   * берётся из MinIO (stat), не из тела запроса, и проверяется по лимиту. Затем создаётся File.
   */
  async confirmDirectUpload(params: {
    bucket: string
    key: string
    ownerId: string
    mime: string
    maxBytes: number
  }) {
    let size: number
    try {
      const stat = await this.minio.statObject(params.bucket, params.key)
      size = stat.size
    } catch {
      throw new AppException('NOT_FOUND', 'Объект не найден — загрузка не завершена')
    }
    if (size > params.maxBytes) {
      await this.minio.removeObject(params.bucket, params.key)
      throw new AppException('FILE_TOO_LARGE', `Файл превышает лимит ${params.maxBytes} байт`)
    }
    return this.prisma.file.create({
      data: {
        bucket: params.bucket,
        key: params.key,
        mime: params.mime,
        size,
        ownerId: params.ownerId,
      },
      select: FILE_SELECT,
    })
  }

  /**
   * Дублирует объект в MinIO на новый ключ и создаёт новую запись File, привязанную к сообщению
   * (Ф9+, пересылка вложений). Копия нужна, т.к. на File есть @@unique([bucket, key]) — один и тот же
   * ключ нельзя привязать к двум сообщениям, а объект остаётся общим только логически быть не может.
   */
  async copyToMessage(
    source: { bucket: string; key: string; mime: string; size: number },
    ownerId: string,
    messageId: string,
  ) {
    const ext = source.key.includes('.') ? source.key.split('.').pop() : undefined
    const newKey = ext ? `${randomUUID()}.${ext}` : randomUUID()
    await this.minio.copyObject(source.bucket, newKey, `/${source.bucket}/${source.key}`)
    return this.prisma.file.create({
      data: {
        bucket: source.bucket,
        key: newKey,
        mime: source.mime,
        size: source.size,
        ownerId,
        messageId,
      },
      select: FILE_SELECT,
    })
  }

  /**
   * Presigned GET к приватному объекту, TTL 15 мин (docs/BACKEND_RULES.md §8).
   * requesterId задан — проверяется владение (generic-эндпоинт /files); undefined —
   * вызывающий модуль отвечает за scope сам (напр. декан читает вложение заявки, Ф7).
   */
  async getPresignedUrl(fileId: string, requesterId?: string): Promise<string> {
    const file = await this.findOrThrow(fileId)
    this.assertOwnership(file, requesterId)
    return this.minio.presignedGetObject(file.bucket, file.key, TTL.PRESIGNED_URL_MINUTES * 60)
  }

  /**
   * Кладёт вспомогательный ОБЪЕКТ-изображение в бакет БЕЗ записи File (напр. постер видео).
   * Валидирует тип (только изображения) и размер. Возвращает ключ. Управление жизненным циклом
   * (удаление) — на вызывающем модуле; бакет должен быть исключён из cleanOrphanFiles.
   */
  async putAuxImage(bucket: string, buffer: Buffer): Promise<string> {
    const detected = await detectAllowedFileType(buffer)
    if (!detected || detected.category !== 'IMAGE') {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Обложка должна быть изображением')
    }
    const size = buffer.byteLength
    if (size > FILE_UPLOAD.MAX_BYTES.IMAGE) {
      throw new AppException(
        'FILE_TOO_LARGE',
        `Файл превышает лимит ${FILE_UPLOAD.MAX_BYTES.IMAGE} байт`,
      )
    }
    const key = `${randomUUID()}.${detected.ext}`
    await this.minio.putObject(bucket, key, buffer, size, { 'Content-Type': detected.mime })
    return key
  }

  /** Удаляет вспомогательный объект по ключу (без записи File). Ошибки глушим — не критично. */
  async removeRawObject(bucket: string, key: string): Promise<void> {
    await this.minio.removeObject(bucket, key).catch(() => undefined)
  }

  /**
   * Удаляет объект в MinIO и запись в БД. Сначала объект, затем запись: при сбое
   * удаления объекта запись остаётся и операцию можно повторить (осиротевший объект — баг, §8).
   */
  async delete(fileId: string, requesterId?: string): Promise<void> {
    const file = await this.findOrThrow(fileId)
    this.assertOwnership(file, requesterId)
    await this.minio.removeObject(file.bucket, file.key)
    await this.prisma.file.delete({ where: { id: file.id } })
    this.logger.log(`Удалён файл ${file.id} из ${file.bucket}`)
  }

  /**
   * Файлы владельца в конкретном бакете, свежие первыми. Используется для медиа профиля
   * (бакет profile-media): модуль profile не обращается к таблице File напрямую (§2.1).
   */
  async listByOwnerAndBucket(ownerId: string, bucket: string, take = 100) {
    return this.prisma.file.findMany({
      where: { ownerId, bucket },
      select: FILE_SELECT,
      orderBy: { createdAt: 'desc' },
      take,
    })
  }

  /** Метаданные файла или NOT_FOUND. */
  async findOrThrow(fileId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId }, select: FILE_SELECT })
    if (!file) {
      throw new AppException('NOT_FOUND', 'Файл не найден')
    }
    return file
  }

  // Владелец сверяется только когда requesterId передан (generic /files-эндпоинты).
  private assertOwnership(file: { ownerId: string }, requesterId?: string): void {
    if (requesterId !== undefined && file.ownerId !== requesterId) {
      throw new AppException('WRONG_SCOPE', 'Файл принадлежит другому пользователю')
    }
  }
}
