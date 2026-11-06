import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Push-сервисы браузеров. Сервер шлёт POST на endpoint подписки, и без списка любой
// пользователь заставлял его стучаться на произвольный HTTPS-адрес (слепой SSRF).
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Яндекс Браузер
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // старый Edge
  'push.apple.com', // Safari
]

export function isPushServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))
  } catch {
    return false
  }
}

const PushEndpoint = z
  .string()
  .url()
  .max(2048)
  .refine(isPushServiceUrl, 'Адрес не принадлежит push-сервису браузера')

// Подписка браузера (PushSubscription.toJSON): endpoint + ключи. Лишние поля (expirationTime)
// отбрасываются (без .strict()).
export const PushSubscribeSchema = z.object({
  endpoint: PushEndpoint,
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
})
export class PushSubscribeDto extends createZodDto(PushSubscribeSchema) {}

export const PushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) })
export class PushUnsubscribeDto extends createZodDto(PushUnsubscribeSchema) {}
