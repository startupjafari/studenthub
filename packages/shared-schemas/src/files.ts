import { z } from 'zod'

// Логический вид бакета: клиент указывает назначение, сервер сам резолвит реальное имя
// бакета из конфигурации (MINIO_BUCKET_*), не доверяя произвольной строке из запроса.
export const FileBucketKind = {
  AVATARS: 'AVATARS',
  POSTS: 'POSTS',
  STORIES: 'STORIES',
  APPLICATIONS: 'APPLICATIONS',
} as const

export type FileBucketKind = (typeof FileBucketKind)[keyof typeof FileBucketKind]

// Параметры буферной загрузки через API (docs/PROJECT.md §5.5, docs/BACKEND_RULES.md §8).
// Сам файл приходит multipart-полем `file`; здесь — только целевой бакет (query).
export const UploadFileSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
  })
  .strict()

export type UploadFileInput = z.infer<typeof UploadFileSchema>

// ── Прямая (presigned) загрузка крупных файлов, минуя API-процесс ────────────
// Буферная загрузка ограничена FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES: файл целиком
// попадает в память процесса. Файлы больше порога (скан диплома, лекция, видео) грузятся
// напрямую в MinIO по подписанной ссылке в три шага: presign → PUT → confirm.

/** Шаг 1: получить подписанную ссылку. `mime` влияет только на расширение ключа. */
export const PresignUploadSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    mime: z.string().min(1).max(120),
  })
  .strict()
export type PresignUploadInput = z.infer<typeof PresignUploadSchema>

/**
 * Шаг 3: подтвердить загрузку — сервер сам смотрит объект в MinIO (размер и реальный тип
 * по magic bytes) и создаёт запись File. Ни размер, ни MIME из тела запроса не берутся.
 */
export const ConfirmUploadSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    key: z.string().min(1).max(300),
    name: z.string().min(1).max(255).optional(),
  })
  .strict()
export type ConfirmUploadInput = z.infer<typeof ConfirmUploadSchema>

/** Подтверждение для доменных загрузок (документ, материал) — бакет определяет сам модуль. */
export const ConfirmDomainUploadSchema = z
  .object({
    key: z.string().min(1).max(300),
    name: z.string().min(1).max(255).optional(),
  })
  .strict()
export type ConfirmDomainUploadInput = z.infer<typeof ConfirmDomainUploadSchema>

/** Запрос presigned-ссылки для доменной загрузки (бакет неявный). */
export const PresignDomainUploadSchema = z.object({ mime: z.string().min(1).max(120) }).strict()
export type PresignDomainUploadInput = z.infer<typeof PresignDomainUploadSchema>

// ── Многочастная загрузка крупных файлов (Фаза 19) ───────────────────────────
// Файлы больше FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES режутся на части, каждая заливается по
// своей подписанной ссылке, сборка — на сервере. Четыре шага: start → urls → PUT частей →
// complete (внутри complete сервер делает ту же проверку, что и confirm обычной прямой
// загрузки: размер из statObject и реальный тип по magic bytes).

/** Шаг 1: открыть загрузку. `size` нужен серверу, чтобы посчитать число частей и отказать заранее. */
export const MultipartStartSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    mime: z.string().min(1).max(120),
    size: z.number().int().positive(),
  })
  .strict()
export type MultipartStartInput = z.infer<typeof MultipartStartSchema>

/**
 * Шаг 2: подписи на диапазон частей `[from, to]`, нумерация с единицы (как в S3).
 *
 * Диапазоном, а не по одной ссылке за запрос: 500 МБ частями по 10 МБ — это 50 частей, и
 * полсотни запросов за подписью упрутся в троттлер выдачи. Диапазон нужен ради докачки —
 * после обрыва запрашиваются только недостающие номера.
 */
export const MultipartUrlsSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    key: z.string().min(1).max(300),
    uploadId: z.string().min(1).max(300),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    path: ['to'],
    message: 'Конец диапазона частей не может быть меньше начала',
  })
export type MultipartUrlsInput = z.infer<typeof MultipartUrlsSchema>

/**
 * Шаг 4: собрать объект из частей.
 *
 * `etag` каждой части приходит от клиента, потому что сервер их взять неоткуда: в minio@8
 * метод `listParts` объявлен protected. Подлог здесь бесполезен — MinIO сверяет etag'и сам
 * и отвергает сборку с чужими, а после сборки объект всё равно проходит проверку типа.
 */
export const MultipartCompleteSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    key: z.string().min(1).max(300),
    uploadId: z.string().min(1).max(300),
    name: z.string().min(1).max(255).optional(),
    parts: z
      .array(z.object({ part: z.number().int().min(1), etag: z.string().min(1).max(200) }).strict())
      .min(1),
  })
  .strict()
export type MultipartCompleteInput = z.infer<typeof MultipartCompleteSchema>

/** Отмена: крестик в интерфейсе, протухшая докачка, уход со страницы. Части удаляются в MinIO. */
export const MultipartAbortSchema = z
  .object({
    bucket: z.enum(Object.values(FileBucketKind) as [FileBucketKind, ...FileBucketKind[]]),
    key: z.string().min(1).max(300),
    uploadId: z.string().min(1).max(300),
  })
  .strict()
export type MultipartAbortInput = z.infer<typeof MultipartAbortSchema>
