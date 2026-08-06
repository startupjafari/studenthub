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
