import type { Client as MinioClient } from 'minio'
import { TTL } from '@studenthub/shared-config'

/**
 * Окно, внутри которого подпись presigned-ссылки не меняется.
 *
 * Подпись S3 включает момент подписания (`X-Amz-Date`), поэтому ссылка, выданная секундой
 * позже, — это уже другой URL, и браузер скачивает ту же картинку заново: для его кеша это
 * чужой ресурс. Округляя момент подписания вниз до окна, все выдачи внутри него дают байт в
 * байт одинаковый URL, и повторный показ ленты или чата берёт байты из кеша.
 *
 * Цена — ссылка живёт меньше номинала: от `TTL − окно` до `TTL` (10–15 минут при 15 и 5).
 * Потолок 15 минут из BACKEND_RULES §8 при этом не нарушается.
 */
export const SIGN_WINDOW_MS = 5 * 60 * 1000

const TTL_MS = TTL.PRESIGNED_URL_MINUTES * 60 * 1000

export function signingWindow(now = Date.now()): { requestDate: Date; expiresAt: Date } {
  const start = Math.floor(now / SIGN_WINDOW_MS) * SIGN_WINDOW_MS
  return { requestDate: new Date(start), expiresAt: new Date(start + TTL_MS) }
}

/** Presigned GET со стабильной в пределах окна подписью (см. `SIGN_WINDOW_MS`). */
export function presignStableGet(
  client: MinioClient,
  bucket: string,
  key: string,
  respHeaders: Record<string, string> = {},
  now = Date.now(),
): Promise<string> {
  const { requestDate } = signingWindow(now)
  return client.presignedGetObject(bucket, key, TTL_MS / 1000, respHeaders, requestDate)
}
