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

/**
 * Сбой шага хранилища в контракте UI (`code` из реестра ошибок).
 *
 * Запрос к MinIO идёт мимо интерцептора приложения, и до экрана доходил сырой AxiosError:
 * его `code` — 'ERR_NETWORK', 'ERR_BAD_REQUEST' — уходил в перевод ключом, и человек видел
 * «Errors.ERR_NETWORK». Наследник Error: текст причины сохраняется для логов и тестов.
 */
export class StorageUploadError extends Error {
  readonly code = 'INTERNAL_ERROR'
  /**
   * Статус ответа хранилища — в той же форме, что у AxiosError: по нему докачка узнаёт, что
   * загрузки больше нет (404), а повтор части — что подпись протухла (403).
   */
  readonly response?: { status: number }

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'StorageUploadError'
    if (status !== undefined) this.response = { status }
  }
}

/**
 * Привести ошибку шага хранилища к {@link StorageUploadError}. Отмену не трогаем: её узнают
 * по сигналу.
 */
export function toStorageError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted || (error instanceof Error && error.name === 'CanceledError')) return error
  if (error instanceof StorageUploadError) return error
  const status = (error as { response?: { status?: unknown } } | undefined)?.response?.status
  return new StorageUploadError(
    error instanceof Error ? error.message : String(error),
    typeof status === 'number' ? status : undefined,
  )
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
/**
 * Залить файл по готовой подписанной ссылке. Отдельно от {@link uploadDirect} — доменные
 * сценарии (вложение чата) сами решают, что делать с ключом после заливки, и шаг `confirm`
 * у них свой.
 */
export async function putPresigned(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await axios.put(url, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      signal,
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (onProgress && event.total) onProgress(Math.min(1, event.loaded / event.total))
      },
    })
  } catch (error) {
    throw toStorageError(error, signal)
  }
}

async function putToStorage(
  target: PresignedTarget,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  try {
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
  } catch (error) {
    throw toStorageError(error)
  }
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
