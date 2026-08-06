import type { AxiosProgressEvent } from 'axios'
import type { FileBucketKind } from '@studenthub/shared-schemas'
import { api } from './instance'

// Ответ POST /files/upload (envelope разворачивается интерцептором в чистую сущность).
// Отдельного типа File в shared-* нет — это форма ответа API, объявляется здесь.
export interface UploadedFile {
  id: string
  bucket: string
  key: string
  mime: string
  size: number
  ownerId: string
  createdAt: string
}

/**
 * Буферная загрузка файла через API (docs/BACKEND_RULES.md §8, ≤ 10 МБ).
 * Прогресс — через onUploadProgress axios. Content-Type multipart axios проставляет сам.
 */
export async function uploadFileRequest(
  bucket: FileBucketKind,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)

  const res = await api.post<UploadedFile>(`/files/upload?bucket=${bucket}`, form, {
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
  return res.data
}
