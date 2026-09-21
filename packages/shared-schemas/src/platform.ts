import { z } from 'zod'

// Контракт управления платформой: рычаги, которыми админ меняет поведение веба без деплоя.
// Читается состояние публично (`GET /platform/state`), пишется только платформенным
// администратором из мини-аппа.

/**
 * Разделы, которые можно погасить целиком. Список закрытый и намеренно короткий: это
 * самостоятельные продукты, исчезновение которых не ломает навигацию по остальному.
 * Расписание, оценки и профиль сюда не входят — платформа без них не платформа.
 */
export const PLATFORM_SECTIONS = [
  'chats',
  'events',
  'documents',
  'applications',
  'portfolio',
  'career',
] as const
export type PlatformSection = (typeof PLATFORM_SECTIONS)[number]

/**
 * Объявление пишется сразу на трёх языках. Частичного перевода схема не принимает: строка
 * на двух языках из трёх — дыра в интерфейсе у тех, кому не повезло с локалью.
 */
const localizedText = z.object({
  ru: z.string().trim().min(1).max(300),
  kk: z.string().trim().min(1).max(300),
  en: z.string().trim().min(1).max(300),
})

/** Потолок техработ. Больше половины суток — это уже не работы, а инцидент с другим сценарием. */
export const MAINTENANCE_MAX_MINUTES = 12 * 60
export const MAINTENANCE_MIN_MINUTES = 5
export const BANNER_MAX_MINUTES = 30 * 24 * 60

/**
 * Длительность, а не метка времени.
 *
 * Клиент присылает «на сколько», сервер сам считает, «до когда». Абсолютное время,
 * посчитанное на телефоне с уехавшими часами, назначило бы окончание техработ не на тот
 * момент — и заглушка либо снялась бы раньше срока, либо висела после него. Часы сервера
 * в этом вопросе единственные, кому можно верить.
 *
 * `null` — снять режим немедленно.
 */
export const SetMaintenanceSchema = z.object({
  minutes: z.number().int().min(MAINTENANCE_MIN_MINUTES).max(MAINTENANCE_MAX_MINUTES).nullable(),
  message: localizedText.nullish(),
  /**
   * Код 2FA. Обязателен только при ВКЛЮЧЕНИИ: остановка платформы — действие, которое
   * нельзя совершить одним промахом по экрану. На снятие код не нужен намеренно, иначе
   * потерянный телефон продлевал бы простой.
   */
  code: z.string().trim().min(6).max(16).optional(),
})
export type SetMaintenanceInput = z.infer<typeof SetMaintenanceSchema>

export const SetBannerSchema = z.object({
  minutes: z.number().int().min(MAINTENANCE_MIN_MINUTES).max(BANNER_MAX_MINUTES).nullable(),
  level: z.enum(['INFO', 'WARNING']).default('INFO'),
  text: localizedText.nullish(),
})
export type SetBannerInput = z.infer<typeof SetBannerSchema>

export const SetSectionsSchema = z.object({
  disabled: z.array(z.enum(PLATFORM_SECTIONS)).max(PLATFORM_SECTIONS.length),
})
export type SetSectionsInput = z.infer<typeof SetSectionsSchema>

/**
 * Объявить версию «Что нового». Только номер: текст ноты едет в бандле web вместе с кодом,
 * который описывает, и веб показывает её, лишь если версия не выше его собственной сборки.
 */
export const AnnounceReleaseSchema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, 'Версия в формате 1.2.3')
    .nullable(),
})
export type AnnounceReleaseInput = z.infer<typeof AnnounceReleaseSchema>

/** Виды уведомлений, которые команда платформы получает в Telegram. */
export const NOTIFICATION_KINDS = ['complaint', 'ticket', 'reply', 'digest'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

const hour = z.number().int().min(0).max(23)

/**
 * Настройки уведомлений команде. Часы — по времени сервера и целые: «не будить с 22 до 8»
 * это решение о ночи, а не о минутах, и половинчатая точность только усложнила бы ввод
 * с телефона.
 *
 * `quietFrom === quietTo` схема не запрещает намеренно: это «тишина круглые сутки», то
 * есть выключить уведомления, не стирая настройку.
 */
export const SetNotificationsSchema = z.object({
  quietFrom: hour.nullable(),
  quietTo: hour.nullable(),
  muted: z.array(z.enum(NOTIFICATION_KINDS)).max(NOTIFICATION_KINDS.length),
  /** id дежурного; null — уведомлять всю команду. */
  dutyUserId: z.string().uuid().nullable(),
  digestHour: hour.nullable(),
})
export type SetNotificationsInput = z.infer<typeof SetNotificationsSchema>
