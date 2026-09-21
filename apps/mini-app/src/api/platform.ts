import { apiGet, apiPatch } from './client'
import type { MessageKey } from '../i18n'

// Рычаги управления вебом. Типы повторяют ответ `GET /platform/state`.
//
// Схемы из @studenthub/shared-schemas сюда не тянутся по той же причине, что и в жалобах:
// мини-апп собирается отдельным приложением, и зависимость привела бы за собой zod со всем
// контрактом платформы ради четырёх полей.

export interface LocalizedText {
  ru: string
  kk: string
  en: string
}

export interface NotificationSettings {
  quietFrom: number | null
  quietTo: number | null
  muted: string[]
  dutyUserId: string | null
  digestHour: number | null
}

export type NotificationKind = 'complaint' | 'ticket' | 'reply' | 'digest'

export const NOTIFICATION_KINDS: { key: NotificationKind; labelKey: MessageKey }[] = [
  { key: 'complaint', labelKey: 'notifKindComplaint' },
  { key: 'ticket', labelKey: 'notifKindTicket' },
  { key: 'reply', labelKey: 'notifKindReply' },
  { key: 'digest', labelKey: 'notifKindDigest' },
]

export interface PlatformState {
  notifications: NotificationSettings
  maintenance: { until: string; message: LocalizedText | null } | null
  banner: { until: string; level: 'INFO' | 'WARNING'; text: LocalizedText } | null
  disabledSections: string[]
  announcedVersion: string | null
}

/** Разделы, которые можно погасить. Совпадает с PLATFORM_SECTIONS в shared-schemas. */
export const SECTIONS = [
  { key: 'chats', labelKey: 'sectionChats' },
  { key: 'events', labelKey: 'sectionEvents' },
  { key: 'documents', labelKey: 'sectionDocuments' },
  { key: 'applications', labelKey: 'sectionApplications' },
  { key: 'portfolio', labelKey: 'sectionPortfolio' },
  { key: 'career', labelKey: 'sectionCareer' },
] as const

/**
 * Готовые формулировки объявлений.
 *
 * Не поле ввода: объявление обязано быть на трёх языках, а набирать их с телефона —
 * работа для клавиатуры и стола, а не для очереди в аэропорту. Здесь выбирают из
 * заготовок; произвольный текст остаётся за вебом.
 */
export const BANNER_PRESETS = [
  {
    key: 'planned',
    labelKey: 'presetPlanned',
    level: 'INFO' as const,
    text: {
      ru: 'Сегодня вечером платформа ненадолго остановится на обновление.',
      kk: 'Бүгін кешке платформа жаңарту үшін қысқа уақытқа тоқтайды.',
      en: 'The platform will pause briefly for an update this evening.',
    },
  },
  {
    key: 'degraded',
    labelKey: 'presetDegraded',
    level: 'WARNING' as const,
    text: {
      ru: 'Платформа отвечает медленнее обычного. Мы уже разбираемся.',
      kk: 'Платформа әдеттегіден баяу жауап беруде. Біз қарап жатырмыз.',
      en: 'The platform is slower than usual. We are looking into it.',
    },
  },
  {
    key: 'resolved',
    labelKey: 'presetResolved',
    level: 'INFO' as const,
    text: {
      ru: 'Сбой устранён, всё работает как обычно. Спасибо за терпение.',
      kk: 'Ақау жойылды, бәрі әдеттегідей жұмыс істеп тұр. Шыдамдылығыңыз үшін рахмет.',
      en: 'The issue is resolved and everything works as usual. Thanks for your patience.',
    },
  },
] as const

export async function fetchPlatformState(): Promise<PlatformState> {
  return apiGet<PlatformState>('/platform/state')
}

/** `minutes: null` — снять режим. Код 2FA обязателен только при включении. */
export async function setMaintenance(
  minutes: number | null,
  code?: string,
): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/maintenance', {
    minutes,
    message: null,
    ...(code ? { code } : {}),
  })
}

export async function setBanner(
  minutes: number | null,
  preset?: (typeof BANNER_PRESETS)[number],
): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/banner', {
    minutes,
    level: preset?.level ?? 'INFO',
    text: preset?.text ?? null,
  })
}

export async function setSections(disabled: string[]): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/sections', { disabled })
}

export async function announceRelease(version: string | null): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/release', { version })
}

/** Настройки уведомлений команде. Отправляются целиком: это состояние, а не команда. */
export async function setNotifications(input: NotificationSettings): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/notifications', input)
}
