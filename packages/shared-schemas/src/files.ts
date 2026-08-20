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
