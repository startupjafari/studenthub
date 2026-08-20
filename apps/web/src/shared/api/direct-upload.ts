import axios, { type AxiosProgressEvent } from 'axios'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import type { UploadedFile } from './files-api'

// Прямая (presigned) загрузка крупных файлов в MinIO, минуя API-процесс.
// Буферная загрузка ограничена FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES (файл целиком
// попадает в память api), поэтому скан диплома или лекция шли только в ошибку. Схема:
//   1) presign — сервер выдаёт подписанный PUT-URL и ключ, привязанный к владельцу;
//   2) PUT напрямую в MinIO (браузер → хранилище, минуя наш сервер);
//   3) confirm — сервер смотрит объект (размер и реальный тип по magic bytes) и создаёт File.

export interface PresignedTarget {
  key: string
  url: string
  expiresAt: string
}

/** Порог, выше которого нужен прямой путь. */
export function needsDirectUpload(size: number): boolean {
  return size > FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES
}

/**
 * Заливает файл по подписанной ссылке.
 *
 * Отдельный axios без интерцепторов приложения: presigned-URL самодостаточен, а наш
 * `Authorization` в запросе к MinIO лишний — сторонний заголовок может не совпасть с
 * подписью, и на 401 сработал бы refresh-цикл интерцептора для чужого хоста.
 */
async function putToStorage(
  target: PresignedTarget,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await axios.put(target.url, file, {
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    // Прогресс по факту отправленных байт: для 25 МБ по мобильной сети это единственный
    // способ показать пользователю, что что-то происходит.
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

/**
 * Полный прямой путь: presign → PUT → confirm. Шаги presign/confirm передаются вызывающим,
 * потому что у каждого домена свои эндпоинты (документ, материал, общий /files).
 */
export async function uploadDirect<T>(params: {
  file: File
  presign: (mime: string) => Promise<PresignedTarget>
  confirm: (key: string, name?: string) => Promise<T>
  onProgress?: (percent: number) => void
}): Promise<T> {
  const target = await params.presign(params.file.type || 'application/octet-stream')
  await putToStorage(target, params.file, params.onProgress)
  return params.confirm(target.key, params.file.name)
}

export type { UploadedFile }
