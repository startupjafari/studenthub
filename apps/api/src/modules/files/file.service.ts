import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { CopyDestinationOptions, CopySourceOptions, type Client as MinioClient } from 'minio'
import sharp from 'sharp'
import { FILE_UPLOAD, TTL, type FileCategory } from '@studenthub/shared-config'
import { PrismaService } from '../../common/prisma/prisma.service'
import { MINIO_CLIENT, MINIO_PUBLIC_CLIENT } from '../../common/minio/minio.constants'
import { presignStableGet } from '../../common/minio/stable-sign'
import { AppException } from '../../common/exceptions/app.exception'
import { attachmentHeader } from '../../common/http/content-disposition'
import { MediaService } from '../media/media.service'
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
  /** Принимать архивы (категория «по приглашению», см. FILE_UPLOAD.OPT_IN_CATEGORIES). */
  allowArchives?: boolean
}

/**
 * Категория «по приглашению» (архив) без явного разрешения модуля не принимается.
 * Проверка здесь, а не в каждом модуле: забытый белый список в новом разделе иначе молча
 * пускал бы туда архивы, потому что общий детектор их узнаёт.
 */
function optInRefused(category: FileCategory, allowArchives: boolean | undefined): boolean {
  const optIn = (FILE_UPLOAD.OPT_IN_CATEGORIES as readonly FileCategory[]).includes(category)
  return optIn && !allowArchives
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
  // Размеры изображения: клиент резервирует под снимок точное место (иначе вёрстка прыгает).
  width: true,
  height: true,
  // Медиа-система: PENDING у свежей загрузки — варианты в работе, клиент пока показывает
  // оригинал; заглушка и длительность появятся после обработки.
  mediaStatus: true,
  placeholder: true,
  durationMs: true,
  createdAt: true,
} as const

// Файл свободен — ни одна сущность на него не ссылается: все FK владельцев пусты, и он не
// медиа сториса и не обложка альбома (эти две связи объявлены со стороны Story/Album).
// Новая связь File с сущностью обязана попасть сюда, иначе общий `DELETE /files/:id`
// снова начнёт снимать вложения мимо модуля-владельца.
const DETACHED_WHERE = {
  postId: null,
  messageId: null,
  materialId: null,
  albumId: null,
  documentId: null,
  submissionId: null,
  stories: { none: {} },
  albumsCovered: { none: {} },
  bookCovers: { none: {} },
} satisfies Prisma.FileWhereInput

const ATTACHMENT_SELECT = {
  postId: true,
  messageId: true,
  materialId: true,
  albumId: true,
  documentId: true,
  submissionId: true,
  _count: { select: { stories: true, albumsCovered: true, bookCovers: true } },
} satisfies Prisma.FileSelect

/** Есть ли у файла сущность-владелец — та же проверка, что в DETACHED_WHERE, но по строке. */
function isAttached(file: Prisma.FileGetPayload<{ select: typeof ATTACHMENT_SELECT }>): boolean {
  return (
    file.postId !== null ||
    file.messageId !== null ||
    file.materialId !== null ||
    file.albumId !== null ||
    file.documentId !== null ||
    file.submissionId !== null ||
    file._count.stories > 0 ||
    file._count.albumsCovered > 0 ||
    file._count.bookCovers > 0
  )
}

function attachedConflict(): AppException {
  return new AppException(
    'CONFLICT',
    'Файл используется — удалите его в разделе, к которому он прикреплён',
  )
}

/**
 * Размеры изображения по содержимому: sharp читает только заголовок, декодировать не нужно.
 * Экзотический или битый файл не должен ронять загрузку — тогда размеров просто нет (NULL),
 * и клиент рисует заглушку усреднённой формы.
 */
async function imageDimensions(buffer: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height, orientation } = await sharp(buffer).metadata()
    if (!width || !height) return null
    // EXIF-поворот (обычное дело для снимков с телефона): браузер разворачивает картинку сам,
    // значит и размеры нужно отдавать уже развёрнутыми — иначе под портретное фото зарезервируется
    // место как под альбомное. Ориентации 5–8 меняют стороны местами.
    return orientation && orientation >= 5 ? { width: height, height: width } : { width, height }
  } catch {
    return null
  }
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
    // Единая медиа-система: каждый новый файл-медиа уходит в обработку (варианты, LQIP,
    // HLS) прямо отсюда — модулям не нужно помнить об этом в каждом месте загрузки.
    private readonly media: MediaService,
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
    allowArchives,
  }: UploadFileParams) {
    const detected = await detectAllowedFileType(buffer)
    if (!detected) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'Тип файла не поддерживается или не распознан',
      )
    }
    if (optInRefused(detected.category, allowArchives)) {
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Архивы здесь не принимаются')
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

    // Размеры снимка снимаем до записи: потом байтов в памяти уже нет, а клиенту они нужны,
    // чтобы держать место под картинку с первого кадра.
    const dims = detected.category === 'IMAGE' ? await imageDimensions(buffer) : null

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
        width: dims?.width,
        height: dims?.height,
        // Обрезаем до лимита колонки; пустое имя не сохраняем.
        name: name?.slice(0, 255) || null,
        mediaStatus: this.media.initialStatus(bucket, detected.mime),
      },
      select: FILE_SELECT,
    })
    this.logger.log(`Загружен файл ${file.id} (${detected.mime}, ${size} байт) → ${bucket}`)
    await this.media.schedule(file)
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
   * Открыть многочастную загрузку (Фаза 19): файлы больше `MULTIPART_THRESHOLD_BYTES`
   * заливаются частями по отдельным подписанным ссылкам.
   *
   * Число частей считает сервер и отказывает заранее: клиент мог бы попросить подписи на
   * тысячу частей файла, который потом не подтвердит, и оплачивало бы это хранилище.
   * Категория здесь НЕ проверяется — реальный тип известен только после сборки, на `complete`;
   * заранее проверяется лишь общий потолок, чтобы не открывать загрузку заведомо лишнего.
   */
  async startMultipart(params: {
    bucket: string
    mime: string
    size: number
    ownerId: string
  }): Promise<{ key: string; uploadId: string; partSize: number; partCount: number }> {
    const ceiling = Math.max(...Object.values(FILE_UPLOAD.MAX_BYTES))
    if (params.size > ceiling) {
      throw new AppException('BAD_REQUEST', 'Файл больше максимально допустимого размера')
    }
    const partSize = FILE_UPLOAD.MULTIPART_PART_BYTES
    const partCount = Math.ceil(params.size / partSize)
    if (partCount > FILE_UPLOAD.MULTIPART_MAX_PARTS) {
      throw new AppException('BAD_REQUEST', 'Слишком много частей для одного файла')
    }

    const ext =
      (params.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 10) || 'bin'
    const key = `${params.ownerId}/${randomUUID()}.${ext}`
    // Тот же префикс владельца, что и у одиночного presign: на нём держится вся проверка
    // прав и на подписи частей, и на сборке.
    // Тип клиента в метаданные не пишем: настоящий закрепляется на confirm по содержимому.
    const uploadId = await this.minio.initiateNewMultipartUpload(params.bucket, key, {
      'Content-Type': 'application/octet-stream',
    })
    return { key, uploadId, partSize, partCount }
  }

  /**
   * Подписи на диапазон частей. Нумерация с единицы — как в протоколе S3.
   *
   * Диапазоном, а не по ссылке за запрос: полусотня частей означала бы полсотни обращений
   * за подписью и упёрлась бы в троттлер. Диапазон же нужен для докачки — после обрыва
   * клиент просит только недостающие номера.
   */
  async presignParts(params: {
    bucket: string
    key: string
    uploadId: string
    ownerId: string
    from: number
    to: number
  }): Promise<{ parts: { part: number; url: string }[]; expiresAt: string }> {
    this.assertKeyOwner(params.key, params.ownerId)
    if (params.to > FILE_UPLOAD.MULTIPART_MAX_PARTS) {
      throw new AppException('BAD_REQUEST', 'Номер части выходит за допустимый предел')
    }

    const ttlSeconds = TTL.PRESIGNED_URL_MINUTES * 60
    const parts: { part: number; url: string }[] = []
    for (let part = params.from; part <= params.to; part += 1) {
      // Подпись с query-параметрами uploadId/partNumber — это и есть PUT части в протоколе S3.
      const url = await this.minioPublic.presignedUrl(
        'PUT',
        params.bucket,
        params.key,
        ttlSeconds,
        {
          uploadId: params.uploadId,
          partNumber: String(part),
        },
      )
      parts.push({ part, url })
    }
    return { parts, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() }
  }

  /**
   * Собрать объект из частей и проверить его так же, как обычную прямую загрузку.
   *
   * Сборку делает сервер, а не подписанная ссылка на `complete`, ровно ради второй половины:
   * после склейки объект проходит `confirmDirectUpload` — размер из `statObject`, тип по
   * magic bytes. Отдай мы сборку клиенту, в приватном бакете появлялись бы объекты, которых
   * никто не смотрел.
   *
   * `etag` частей приходят от клиента: в minio@8 `listParts` объявлен protected, и взять их
   * серверу неоткуда. Подлог бесполезен — MinIO сверяет их сам и отвергает чужие.
   */
  async completeMultipart(params: {
    bucket: string
    key: string
    uploadId: string
    ownerId: string
    parts: { part: number; etag: string }[]
    name?: string
    /** Привязка собранного объекта к сообщению чата (Ф19.0). */
    messageId?: string
    expectedCategory?: FileCategory
    allowedMimes?: ReadonlySet<string>
    /** Принимать архивы — только вложения чата. */
    allowArchives?: boolean
  }) {
    this.assertKeyOwner(params.key, params.ownerId)
    // Порядок частей задаёт порядок байтов в объекте: части приходят параллельно и
    // подтверждаются в произвольном порядке, а склеивать их надо по номерам.
    const ordered = [...params.parts].sort((a, b) => a.part - b.part)
    try {
      await this.minio.completeMultipartUpload(params.bucket, params.key, params.uploadId, ordered)
    } catch (e) {
      this.logger.warn(`Сборка многочастной загрузки не удалась: ${String(e)}`)
      throw new AppException('BAD_REQUEST', 'Не удалось собрать файл из частей')
    }
    return this.confirmDirectUpload({
      bucket: params.bucket,
      key: params.key,
      ownerId: params.ownerId,
      name: params.name,
      messageId: params.messageId,
      expectedCategory: params.expectedCategory,
      allowedMimes: params.allowedMimes,
      allowArchives: params.allowArchives,
    })
  }

  /** Отменить загрузку: MinIO удаляет уже залитые части. Молча, если отменять уже нечего. */
  async abortMultipart(params: {
    bucket: string
    key: string
    uploadId: string
    ownerId: string
  }): Promise<void> {
    this.assertKeyOwner(params.key, params.ownerId)
    try {
      await this.minio.abortMultipartUpload(params.bucket, params.key, params.uploadId)
    } catch (e) {
      // Отмена — операция уборки: её зовут и из размонтирования компонента, и повторно.
      // Отсутствующая загрузка здесь не ошибка вызывающего.
      this.logger.warn(`Отмена многочастной загрузки не удалась: ${String(e)}`)
    }
  }

  /**
   * Ключ обязан принадлежать вызывающему. Вынесено из `confirmDirectUpload`: та же проверка
   * нужна на каждом шаге многочастной загрузки — зная чужой ключ и uploadId, иначе можно
   * дописать часть в чужой объект.
   */
  private assertKeyOwner(key: string, ownerId: string): void {
    if (!key.startsWith(`${ownerId}/`)) {
      throw new AppException('FORBIDDEN', 'Ключ не принадлежит вызывающему')
    }
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
   *
   * Проверенный объект ПЕРЕНОСИТСЯ на серверный ключ, которого выданная подпись не знает.
   * Ссылка на PUT подписана только по ключу и живёт 15 минут: оставь мы файл на месте, тем
   * же URL после подтверждения клали бы что угодно — HTML со скриптом в публичный бакет,
   * гигабайты мимо квоты, подмену уже просмотренного вложения. Серверный ключ — без префикса
   * владельца, как у буферной загрузки, поэтому и повторный `confirm` по нему не пройдёт.
   *
   * Ключ, на который уже ссылается File, не подтверждается вовсе: иначе общий
   * `POST /files/confirm` перекладывал бы или удалял (архив без разрешения) объект уже
   * прикреплённого файла мимо модуля-владельца.
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
    /** Вложение сообщения чата: объект уже в бакете, запись создаётся сразу привязанной. */
    messageId?: string
    name?: string
    /** Принимать архивы (FILE_UPLOAD.OPT_IN_CATEGORIES) — только вложения чата. */
    allowArchives?: boolean
  }) {
    this.assertKeyOwner(params.key, params.ownerId)
    const linked = await this.prisma.file.count({
      where: { bucket: params.bucket, key: params.key },
    })
    if (linked > 0) throw new AppException('CONFLICT', 'Загрузка уже подтверждена')

    let size: number
    let etag: string
    try {
      const stat = await this.minio.statObject(params.bucket, params.key)
      size = stat.size
      etag = stat.etag
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
    if (optInRefused(detected.category, params.allowArchives)) {
      await this.discard(params.bucket, params.key)
      throw new AppException('FILE_TYPE_NOT_ALLOWED', 'Архивы здесь не принимаются')
    }

    const maxBytes = FILE_UPLOAD.MAX_BYTES[detected.category]
    if (size > maxBytes) {
      await this.discard(params.bucket, params.key)
      throw new AppException('FILE_TOO_LARGE', `Файл превышает лимит ${maxBytes} байт`)
    }

    // Тип объекта в хранилище — тот, что определён по содержимому, а не заявленный клиентом
    // при PUT. Иначе файл, начинающийся как PDF или GIF, но залитый с Content-Type
    // text/html, открывался бы в браузере как страница на домене хранилища (XSS, фишинг) —
    // а у публичных бакетов ещё и по постоянной ссылке.
    //
    // Копия — на новый ключ (см. описание метода) и только того содержимого, которое видел
    // `statObject`: подменённый за время проверки объект не совпадёт по ETag и не переедет.
    const key = `${randomUUID()}.${detected.ext}`
    try {
      await this.minio.copyObject(
        new CopySourceOptions({ Bucket: params.bucket, Object: params.key, MatchETag: etag }),
        new CopyDestinationOptions({
          Bucket: params.bucket,
          Object: key,
          MetadataDirective: 'REPLACE',
          Headers: { 'Content-Type': detected.mime },
        }),
      )
    } catch (error) {
      await this.discard(params.bucket, params.key)
      if ((error as { code?: string }).code === 'PreconditionFailed') {
        throw new AppException('BAD_REQUEST', 'Файл изменился во время проверки — загрузите заново')
      }
      this.logger.error(
        { err: error, bucket: params.bucket },
        'Не удалось закрепить тип загруженного объекта',
      )
      throw new AppException('INTERNAL_ERROR', 'Не удалось сохранить файл')
    }

    const file = await this.prisma.file.create({
      data: {
        bucket: params.bucket,
        key,
        mime: detected.mime,
        size,
        ownerId: params.ownerId,
        materialId: params.materialId,
        messageId: params.messageId,
        name: params.name?.slice(0, 255) || null,
        mediaStatus: this.media.initialStatus(params.bucket, detected.mime),
      },
      select: FILE_SELECT,
    })
    // Объект по выданной подписи больше не нужен; положенное туда позже станет ничьим и
    // уйдёт с ночной cleanOrphanFiles.
    await this.discard(params.bucket, params.key)
    this.logger.log(
      `Подтверждена прямая загрузка ${file.id} (${detected.mime}, ${size} байт) → ${params.bucket}`,
    )
    // Здесь же доезжают размеры снимка: при прямой загрузке API не видел байтов, и
    // width/height у такого файла проставит обработчик медиа.
    await this.media.schedule(file)
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

  /**
   * Удалить объект, не сорвав основную ошибку, если удаление тоже не удалось. Объект, на
   * который ссылается File, не трогаем: его снимает только модуль-владелец (§8).
   */
  private async discard(bucket: string, key: string): Promise<void> {
    try {
      if ((await this.prisma.file.count({ where: { bucket, key } })) > 0) return
      await this.minio.removeObject(bucket, key)
    } catch (error) {
      this.logger.warn(
        `Не удалось удалить отклонённый объект ${bucket}/${key}: ${(error as Error).message}`,
      )
    }
  }

  /**
   * Дублирует объект в MinIO на новый ключ и создаёт новую запись File, привязанную к сообщению
   * (Ф9+, пересылка вложений). Копия остаётся копией и после снятия @@unique([bucket, key]):
   * пересланное вложение живёт своей жизнью, и удаление исходного сообщения не должно гасить
   * вложение у получателя. Ссылки на общий объект — приём сида, а не поведение продукта.
   *
   * Без `messageId` копия создаётся непривязанной: пересылка сначала копирует вложения, а
   * сообщение заводит и привязывает их одной транзакцией — сбой копирования не оставляет
   * в чате пересылку без вложений.
   */
  async copyToMessage(
    source: {
      /** id исходной записи — чтобы скопировать её готовые варианты. */
      id?: string
      bucket: string
      key: string
      mime: string
      size: number
      name?: string | null
      // Размеры оригинала: у копии тот же объект, повторно считать нечего.
      width?: number | null
      height?: number | null
    },
    ownerId: string,
    messageId?: string,
  ) {
    const ext = source.key.includes('.') ? source.key.split('.').pop() : undefined
    const newKey = ext ? `${randomUUID()}.${ext}` : randomUUID()
    await this.minio.copyObject(source.bucket, newKey, `/${source.bucket}/${source.key}`)
    const copy = await this.prisma.file.create({
      data: {
        bucket: source.bucket,
        key: newKey,
        mime: source.mime,
        size: source.size,
        ownerId,
        messageId,
        width: source.width ?? null,
        height: source.height ?? null,
        name: source.name ?? null,
        mediaStatus: this.media.initialStatus(source.bucket, source.mime),
      },
      select: FILE_SELECT,
    })
    // Варианты копируются, а не готовятся заново: пересланное видео не перекодируется.
    if (source.id) await this.media.scheduleCopy(source.id, copy)
    else await this.media.schedule(copy)
    return copy
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
  /**
   * Пачка ссылок на чтение по id. Владение НЕ проверяется — как и у `getPresignedUrl` без
   * `requesterId`, scope остаётся на вызывающем модуле (календарь медиа чата подписывает
   * файлы уже проверенного чата).
   *
   * Отдельный метод, а не цикл из `getPresignedUrl`: тот на каждый файл ходит в БД, а здесь
   * строки читаются одним запросом — подпись сама по себе локальная и стоит ничего.
   * Возвращается Map, потому что порядок и полнота не гарантированы: файл мог исчезнуть.
   */
  async getPresignedUrls(fileIds: string[]): Promise<Map<string, string>> {
    if (fileIds.length === 0) return new Map()
    const files = await this.prisma.file.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, bucket: true, key: true, mime: true },
      take: fileIds.length,
    })
    const out = new Map<string, string>()
    await Promise.all(
      files.map(async (f) => {
        out.set(
          f.id,
          await presignStableGet(this.minioPublic, f.bucket, f.key, {
            'response-content-type': f.mime,
          }),
        )
      }),
    )
    return out
  }

  async getPresignedUrl(
    fileId: string,
    requesterId?: string,
    asAttachment = false,
  ): Promise<string> {
    const file = await this.findOrThrow(fileId)
    this.assertOwnership(file, requesterId)
    // Тип ответа задаёт сервер (определён по содержимому при загрузке): метаданные объекта,
    // залитого до закрепления типа на confirm, могли остаться клиентскими.
    // Подпись стабильна в пределах окна (common/minio/stable-sign): повторная выдача ссылки
    // на тот же файл даёт тот же URL, и браузер берёт байты из кеша, а не качает заново.
    return presignStableGet(this.minioPublic, file.bucket, file.key, {
      'response-content-type': file.mime,
      ...(asAttachment ? { 'response-content-disposition': attachmentHeader(file.name) } : {}),
    })
  }

  /**
   * Кладёт вспомогательный ОБЪЕКТ-изображение в бакет БЕЗ записи File (напр. постер видео).
   * Валидирует тип (только изображения) и размер. Возвращает ключ. Управление жизненным циклом
   * (удаление) — на вызывающем модуле; `cleanOrphanFiles` узнаёт такие ключи по `File.posterKey`
   * и `User.coverUrl` — новый вид ссылки на raw-объект обязан попасть туда же.
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
   * Удаляет запись в БД и — если это была последняя ссылка на объект — сам объект в MinIO.
   *
   * Порядок обратный прежнему («сначала объект, потом запись»): пара (bucket, key) больше не
   * уникальна, на один объект может ссылаться несколько записей (общий пул медиа у сида), и
   * пересчитать оставшиеся ссылки можно только после того, как своя запись ушла.
   *
   * Гонка двух последних удалений оставит объект без записей — это осиротевший объект, его
   * ночью уберёт cleanOrphanFiles. Обратная ошибка непоправима: снесённый объект, на который
   * ещё ссылаются, гасит картинку у всех остальных владельцев ссылок.
   */
  async delete(fileId: string, requesterId?: string): Promise<void> {
    const file = await this.findOrThrow(fileId)
    this.assertOwnership(file, requesterId)
    await this.prisma.file.delete({ where: { id: file.id } })
    await this.purgeStorage(file)
  }

  /**
   * Удаление через общий `DELETE /files/:id`: только своего файла, который ни к чему не
   * прикреплён, — брошенной загрузки, неотправленного вложения, страницы ещё не созданного
   * документа.
   *
   * Прикреплённый файл (вложение сообщения, медиа поста или сториса, файл материала,
   * страница документа, файл сданной работы, фото альбома или его обложка) — `CONFLICT`:
   * его снимает только модуль-владелец со своими проверками и аудитом. Иначе владелец
   * файла убирал скан из документа на проверке, вложение из чата, где он забанен, медиа
   * из чужого альбома, а сущность оставалась «битой» и об этом не знала.
   *
   * `lockedBuckets` — бакеты, где ссылка на файл живёт не в FK, а в URL сущности (аватары
   * пользователя и чата): такие файлы общим маршрутом не удаляются вовсе.
   *
   * Удаление условное — та же проверка «свободен» стоит в WHERE: модуль мог прикрепить файл
   * между чтением и удалением (отправка сообщения с этим вложением).
   */
  async deleteDetached(
    fileId: string,
    requesterId: string,
    lockedBuckets: readonly string[] = [],
  ): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: { ...FILE_SELECT, ...ATTACHMENT_SELECT },
    })
    if (!file) throw new AppException('NOT_FOUND', 'Файл не найден')
    this.assertOwnership(file, requesterId)
    if (lockedBuckets.includes(file.bucket) || isAttached(file)) throw attachedConflict()

    const { count } = await this.prisma.file.deleteMany({
      where: { id: file.id, ownerId: requesterId, ...DETACHED_WHERE },
    })
    if (count === 0) throw attachedConflict()
    await this.purgeStorage(file)
  }

  /**
   * Объект и варианты записи, которую только что удалили. Объект — только когда это была
   * последняя ссылка на него (см. `delete`).
   */
  private async purgeStorage(file: { id: string; bucket: string; key: string }): Promise<void> {
    // Варианты принадлежат записи, а не объекту: у копий и у записей общего пула сида
    // префикс свой, поэтому сносим его всегда. Не вышло — подберёт ночная чистка.
    await this.media.purgeVariants(file.bucket, file.id).catch((err: unknown) => {
      this.logger.warn({ err, fileId: file.id }, 'Не удалось удалить варианты медиа')
    })
    const refs = await this.prisma.file.count({
      where: { bucket: file.bucket, key: file.key },
    })
    if (refs === 0) {
      await this.minio.removeObject(file.bucket, file.key)
      this.logger.log(`Удалён файл ${file.id} из ${file.bucket}`)
      return
    }
    this.logger.log(
      `Удалена запись файла ${file.id}; объект ${file.bucket}/${file.key} оставлен: ссылок ещё ${refs}`,
    )
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
