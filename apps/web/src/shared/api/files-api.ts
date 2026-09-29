import type { AxiosProgressEvent } from 'axios'
import type { FileBucketKind } from '@studenthub/shared-schemas'
import { api } from './instance'
import type { MultipartTarget, UploadedPart } from './multipart-upload'

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

// ── Многочастная загрузка через общий /files (Фаза 19) ───────────────────────
// Доменные модули (документы, материалы, чат) при необходимости заводят свои пары так же,
// как у одиночного presign: бакет там неявный и определяется самим модулем.

/** Шаг 1: открыть загрузку. Число и размер частей считает сервер. */
export async function multipartStartRequest(
  bucket: FileBucketKind,
  mime: string,
  size: number,
): Promise<MultipartTarget> {
  const { data } = await api.post<MultipartTarget>('/files/multipart/start', {
    bucket,
    mime,
    size,
  })
  return data
}

/** Шаг 2: подписи на диапазон частей. Диапазоном, потому что их полсотни. */
export async function multipartUrlsRequest(
  bucket: FileBucketKind,
  input: { key: string; uploadId: string; from: number; to: number },
): Promise<{ part: number; url: string }[]> {
  const { data } = await api.post<{ parts: { part: number; url: string }[]; expiresAt: string }>(
    '/files/multipart/urls',
    { bucket, ...input },
  )
  return data.parts
}

/** Шаг 4: сборка. Сервер склеивает части и проверяет объект так же, как обычный confirm. */
export async function multipartCompleteRequest(
  bucket: FileBucketKind,
  input: { key: string; uploadId: string; parts: UploadedPart[]; name?: string },
): Promise<UploadedFile> {
  const { data } = await api.post<UploadedFile>('/files/multipart/complete', { bucket, ...input })
  return data
}

/** Отмена: хранилище удаляет уже залитые части. */
export async function multipartAbortRequest(
  bucket: FileBucketKind,
  input: { key: string; uploadId: string },
): Promise<void> {
  await api.post('/files/multipart/abort', { bucket, ...input })
}
