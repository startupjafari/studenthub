import type { AxiosProgressEvent } from 'axios'
import { api } from './instance'
import { needsDirectUpload, uploadDirect, type PresignedTarget } from './direct-upload'
import { needsMultipartUpload, type MultipartTarget } from './multipart-upload'
import { uploadResumable } from './resumable-upload'
import type { ResumeStore } from './upload-resume'

/**
 * Загрузка файла в доменный модуль — материал, документ, сдачу задания (21.B1).
 *
 * Путь выбирается по размеру, как у вложений чата и общего `uploadToBucket`:
 * - до `DIRECT_UPLOAD_THRESHOLD_BYTES` (10 МБ) — буферно через api: `POST {base}`;
 * - до `MULTIPART_THRESHOLD_BYTES` (50 МБ) — одним подписанным PUT:
 *   `{base}/presign` → PUT в хранилище → `{base}/confirm`;
 * - крупнее — частями с докачкой: `{base}/multipart/start|urls|complete|abort`.
 *
 * Маршруты у модулей свои, а не общий `/files`: бакет неявный, и права на сущность (материал,
 * задание) сервер проверяет на каждом шаге. У всех трёх модулей они лежат под одним префиксом,
 * поэтому достаточно `base`.
 *
 * Отмена (`signal`) обрывает текущий шаг. У многочастной загрузки она же зовёт `abort` —
 * хранилище удаляет залитые части. Обрыв сети отменой не считается: состояние остаётся в
 * IndexedDB, и повторный выбор того же файла продолжит загрузку с места обрыва.
 */
export async function uploadToDomain<T>(params: {
  file: File
  /** Префикс маршрутов модуля, напр. `/materials/<id>/files`. */
  base: string
  /**
   * Отпечаток докачки: один и тот же файл в разные сущности — разные загрузки. Иначе
   * параллельная заливка одного ролика в два материала делила бы одну запись состояния.
   */
  scope: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
  /** Подменяется в тестах; по умолчанию — IndexedDB. */
  store?: ResumeStore
}): Promise<T> {
  const { file, base, onProgress, signal } = params

  if (needsMultipartUpload(file.size)) {
    return uploadResumable<T>({
      file,
      bucket: params.scope,
      store: params.store,
      signal,
      start: async (mime, size) => {
        const { data } = await api.post<MultipartTarget>(`${base}/multipart/start`, { mime, size })
        return data
      },
      urls: async (range) => {
        const { data } = await api.post<{ parts: { part: number; url: string }[] }>(
          `${base}/multipart/urls`,
          range,
        )
        return data.parts
      },
      complete: async ({ key, uploadId, parts, name }) => {
        const { data } = await api.post<T>(`${base}/multipart/complete`, {
          key,
          uploadId,
          parts,
          // Схема на сервере строгая и пустое имя не примет.
          ...(name ? { name } : {}),
        })
        return data
      },
      abort: async (input) => {
        await api.post(`${base}/multipart/abort`, input)
      },
      onProgress: onProgress ? (fraction) => onProgress(Math.round(fraction * 100)) : undefined,
    })
  }

  if (needsDirectUpload(file.size)) {
    return uploadDirect<T>({
      file,
      signal,
      onProgress,
      presign: async (mime) => {
        const { data } = await api.post<PresignedTarget>(`${base}/presign`, { mime })
        return data
      },
      confirm: async (key, name) => {
        const { data } = await api.post<T>(`${base}/confirm`, { key, ...(name ? { name } : {}) })
        return data
      },
    })
  }

  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<T>(base, form, {
    signal,
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}
