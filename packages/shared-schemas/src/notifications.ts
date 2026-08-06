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
