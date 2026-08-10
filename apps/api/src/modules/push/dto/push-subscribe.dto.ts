import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Подписка браузера (PushSubscription.toJSON): endpoint + ключи. Лишние поля (expirationTime)
// отбрасываются (без .strict()).
export const PushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
})
export class PushSubscribeDto extends createZodDto(PushSubscribeSchema) {}

export const PushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) })
export class PushUnsubscribeDto extends createZodDto(PushUnsubscribeSchema) {}
