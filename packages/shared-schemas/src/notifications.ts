import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Список уведомлений: cursor-пагинация + опциональный фильтр «только непрочитанные».
export const NotificationListQuerySchema = CursorPaginationSchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
})
export type NotificationListQueryInput = z.infer<typeof NotificationListQuerySchema>

// Обновление настроек уведомлений: любое подмножество каналов/типов (docs/PROJECT.md §10.1).
// Пустой объект допустим (no-op). Строгий режим — неизвестные поля отклоняются.
export const UpdateNotificationSettingsSchema = z
  .object({
    emailEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    scheduleChangeEnabled: z.boolean().optional(),
    appUpdateEnabled: z.boolean().optional(),
    messageEnabled: z.boolean().optional(),
    postEnabled: z.boolean().optional(),
    eventEnabled: z.boolean().optional(),
    systemEnabled: z.boolean().optional(),
  })
  .strict()
export type UpdateNotificationSettingsInput = z.infer<typeof UpdateNotificationSettingsSchema>

// Регистрация устройства для пушей (план iOS, Задача Б1).
//
// Платформа приходит от клиента, а не выводится по User-Agent: нативное приложение
// и так знает, где оно работает, а гадать по заголовку — способ однажды отправить
// APNs-пуш в браузер.
export const RegisterDeviceSchema = z
  .object({
    token: z.string().min(16).max(400),
    platform: z.enum(['IOS']),
    appVersion: z.string().max(64).optional(),
  })
  .strict()
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceSchema>

export const UnregisterDeviceSchema = z.object({ token: z.string().min(16).max(400) }).strict()
export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceSchema>
