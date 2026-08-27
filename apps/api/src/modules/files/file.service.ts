import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Client as MinioClient } from 'minio'
import { FILE_UPLOAD, TTL, type FileCategory } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT, MINIO_PUBLIC_CLIENT } from '../../common/minio/minio.constants'
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
  /** Привязка к учебному материалу (Ф12). */
  materialId?: string
  /** Привязка к сообщению чата (Ф9+): вложение сообщения. */
  messageId?: string
  /** Оригинальное имя файла при загрузке (Ф9+): для отображения в чате как в Telegram. */
  name?: string
}

// Сколько байт читать из MinIO для определения типа: file-type смотрит только заголовок,
// 4100 байт — рекомендованный минимум библиотеки, покрывающий все её сигнатуры.
const MIME_SNIFF_BYTES = 4100

// Поля File, безопасные для отдачи наружу (passwordHash и т.п. здесь неприменимы, но select фиксируем).
const FILE_SELECT = {
  id: true,
  bucket: true,
  key: true,
  mime: true,
  size: true,
  // Оригинальное имя файла: нужно и чату (отображение как в Telegram), и подтверждению
  // прямой загрузки — иначе принимаем name, но наружу его не отдаём.
  name: true,
  ownerId: true,
  materialId: true,
  messageId: true,
  posterKey: true,
  createdAt: true,
} as const

/**
 * Значение `Content-Disposition` для скачивания.
 *
 * Две формы имени обязательны: `filename` понимают все браузеры, но только ASCII —
 * кириллица в нём превратилась бы в мусор; `filename*` (RFC 5987) несёт настоящее имя
 * в UTF-8. Кавычки и обратный слэш в ASCII-варианте экранируются, иначе имя файла
 * могло бы закрыть строку и подставить свои параметры в заголовок.
 */
function attachmentHeader(name: string | null): string {
  const safe = name?.trim() || 'file'
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`
}

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
    // Отдельный клиент на публичный адрес — только для presigned-ссылок в браузер.
    @Inject(MINIO_PUBLIC_CLIENT) private readonly minioPublic: MinioClient,
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
    materialId,
    messageId,
    name,
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
        materialId,
        messageId,
        // Обрезаем до лимита колонки; пустое имя не сохраняем.
        name: name?.slice(0, 255) || null,
      },
      select: FILE_SELECT,
    })
    this.logger.log(`Загружен файл ${file.id} (${detected.mime}, ${size} байт) → ${bucket}`)
    return file
  }

  /**
   * Presigned PUT URL для прямой загрузки крупного объекта в MinIO, минуя API-процесс
   * (docs/BACKEND_RULES.md §8: файлы > порога — только presigned). Ключ генерируется здесь.
   *
   * Ключ ПРЕФИКСИРУЕТСЯ идентификатором владельца, и `confirmDirectUpload` требует этот
   * префикс. Без привязки владелец подтверждения не проверяем никак: зная ключ чужого
   * объекта (а он виден в presigned-ссылке на скачивание), пользователь мог бы объявить
   * чужой объект своим файлом и удалить его вместе со «своей» записью.
   *
   * `mime` от клиента влияет ТОЛЬКО на расширение в ключе — реальный тип определяется
   * на подтверждении по содержимому.
   */
  async presignPut(
    bucket: string,
    mime: string,
    ownerId: string,
  ): Promise<{ key: string; url: string; expiresAt: string }> {
    const ext = (mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin'
    const key = `${ownerId}/${randomUUID()}.${ext}`
    const ttlSeconds = TTL.PRESIGNED_URL_MINUTES * 60
    const url = await this.minioPublic.presignedPutObject(bucket, key, ttlSeconds)
    return { key, url, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() }
  }

  /**
   * Подтверждение прямой (presigned) загрузки. Ничему из запроса не верим:
   *
   * - ключ обязан принадлежать вызывающему (префикс владельца, см. `presignPut`);
   * - размер берётся из MinIO (`statObject`), не из тела;
   * - **тип определяется по magic bytes** — читаем начало объекта из MinIO и прогоняем
   *   через тот же детектор, что и буферная загрузка. При presigned API не видит байтов,
   *   и объявленный клиентом MIME здесь был бы просто утверждением: можно объявить
   *   `application/pdf`, а положить SVG со скриптом — он потом откроется в браузере
   *   по presigned-ссылке (§14.9).
   *
   * Любая неудачная проверка удаляет объект: в приватном бакете не должно оставаться
   * мусора, за который никто не отвечает.
   */
  async confirmDirectUpload(params: {
    bucket: string
    key: string
    ownerId: string
    /** Если задано — реальная категория обязана совпасть (напр. аватар → IMAGE). */
    expectedCategory?: FileCategory
    /** Если задано — реальный MIME обязан входить в набор (напр. документ → PDF/JPG/PNG). */
    allowedMimes?: ReadonlySet<string>
    materialId?: string
    name?: string
  }) {
    if (!params.key.startsWith(`${params.ownerId}/`)) {
      throw new AppException('FORBIDDEN', 'Ключ не принадлежит вызывающему')
    }

    let size: number
    try {
      const stat = await this.minio.statObject(params.bucket, params.key)
      size = stat.size
    } catch {
      throw new AppException('NOT_FOUND', 'Объект не найден — загрузка не завершена')
    }

    const detected = await this.detectUploadedType(params.bucket, params.key)
    if (!detected) {
      await this.discard(params.bucket, params.key)
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'Тип файла не поддерживается или не распознан',
      )
    }
    if (params.expectedCategory && detected.category !== params.expectedCategory) {
      await this.discard(params.bucket, params.key)
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        `Ожидается файл категории ${params.expectedCategory}`,
      )
    }
    if (params.allowedMimes && !params.allowedMimes.has(detected.mime)) {
      await this.discard(params.bucket, params.key)
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Тип файла не поддерживается')
    }

    const maxBytes = FILE_UPLOAD.MAX_BYTES[detected.category]
    if (size > maxBytes) {
      await this.discard(params.bucket, params.key)
      throw new AppException('FILE_TOO_LARGE', `Файл превышает лимит ${maxBytes} байт`)
    }

    const file = await this.prisma.file.create({
      data: {
        bucket: params.bucket,
        key: params.key,
        mime: detected.mime,
        size,
        ownerId: params.ownerId,
        materialId: params.materialId,
        name: params.name?.slice(0, 255) || null,
      },
      select: FILE_SELECT,
    })
    this.logger.log(
      `Подтверждена прямая загрузка ${file.id} (${detected.mime}, ${size} байт) → ${params.bucket}`,
    )
    return file
  }

  /** Тип загруженного объекта по началу содержимого (magic bytes хватает первых килобайт). */
  private async detectUploadedType(bucket: string, key: string) {
    let head: Buffer
    try {
      head = await this.readHead(bucket, key, MIME_SNIFF_BYTES)
    } catch {
      throw new AppException('NOT_FOUND', 'Объект недоступен для проверки типа')
    }
    return detectAllowedFileType(head)
  }

  /** Первые `length` байт объекта из MinIO. */
  private async readHead(bucket: string, key: string, length: number): Promise<Buffer> {
    const stream = await this.minio.getPartialObject(bucket, key, 0, length)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  /** Удалить объект, не сорвав основную ошибку, если удаление тоже не удалось. */
  private async discard(bucket: string, key: string): Promise<void> {
    try {
      await this.minio.removeObject(bucket, key)
    } catch (error) {
      this.logger.warn(
        `Не удалось удалить отклонённый объект ${bucket}/${key}: ${(error as Error).message}`,
      )
    }
  }

  /**
   * Дублирует объект в MinIO на новый ключ и создаёт новую запись File, привязанную к сообщению
   * (Ф9+, пересылка вложений). Копия нужна, т.к. на File есть @@unique([bucket, key]) — один и тот же
   * ключ нельзя привязать к двум сообщениям, а объект остаётся общим только логически быть не может.
   */
  async copyToMessage(
    source: { bucket: string; key: string; mime: string; size: number; name?: string | null },
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
        name: source.name ?? null,
      },
      select: FILE_SELECT,
    })
  }

  /**
   * Presigned GET к приватному объекту, TTL 15 мин (docs/BACKEND_RULES.md §8).
   * requesterId задан — проверяется владение (generic-эндпоинт /files); undefined —
   * вызывающий модуль отвечает за scope сам (напр. декан читает вложение заявки, Ф7).
   *
   * `asAttachment` — ссылка на СКАЧИВАНИЕ: в неё подписывается заголовок
   * `Content-Disposition: attachment`. Без него скачать файл из браузера нельзя:
   * объект лежит в MinIO, то есть на другом origin, а атрибут `download` у ссылки
   * кросс-origin игнорируется — браузер просто уходит на файл новой вкладкой.
   * На `<img>`/`<video>` заголовок не влияет (он действует только на навигацию),
   * поэтому просмотрщику по-прежнему нужна обычная ссылка.
   */
  async getPresignedUrl(
    fileId: string,
    requesterId?: string,
    asAttachment = false,
  ): Promise<string> {
    const file = await this.findOrThrow(fileId)
    this.assertOwnership(file, requesterId)
    return this.minioPublic.presignedGetObject(
      file.bucket,
      file.key,
      TTL.PRESIGNED_URL_MINUTES * 60,
      asAttachment ? { 'response-content-disposition': attachmentHeader(file.name) } : undefined,
    )
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

  /** Читает объект целиком в память (для обработки в очереди: генерация превью и т.п.). */
  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.minio.getObject(bucket, key)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
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
