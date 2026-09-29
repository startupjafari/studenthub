import { apiGet, apiPatch, apiPost } from './client'
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
  maintenance: {
    until: string
    message: LocalizedText | null
    startsAt: string | null
    active: boolean
  } | null
  banner: {
    until: string
    level: 'INFO' | 'WARNING'
    text: LocalizedText
    roles: string[]
    universityIds: string[]
  } | null
  disabledSections: string[]
  announcedVersion: string | null
  season: { off: boolean; override: string | null }
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
 * Сезоны, которые можно включить принудительно. Совпадает с SEASON_IDS в shared-schemas;
 * подписи здесь свои — словарь мини-аппа отдельный, как и у разделов выше.
 */
export const SEASONS = [
  { key: 'new-year', labelKey: 'seasonNewYear' },
  { key: 'new-year-eve', labelKey: 'seasonNewYearEve' },
  { key: 'orthodox-christmas', labelKey: 'seasonOrthodoxChristmas' },
  { key: 'womens-day', labelKey: 'seasonWomensDay' },
  { key: 'nauryz', labelKey: 'seasonNauryz' },
  { key: 'unity-day', labelKey: 'seasonUnityDay' },
  { key: 'defender-day', labelKey: 'seasonDefenderDay' },
  { key: 'victory-day', labelKey: 'seasonVictoryDay' },
  { key: 'kurban-ait', labelKey: 'seasonKurbanAit' },
  { key: 'oraza-ait', labelKey: 'seasonOrazaAit' },
  { key: 'capital-day', labelKey: 'seasonCapitalDay' },
  { key: 'constitution-day', labelKey: 'seasonConstitutionDay' },
  { key: 'republic-day', labelKey: 'seasonRepublicDay' },
  { key: 'independence-day', labelKey: 'seasonIndependenceDay' },
  { key: 'knowledge-day', labelKey: 'seasonKnowledgeDay' },
  { key: 'teachers-day', labelKey: 'seasonTeachersDay' },
  { key: 'languages-day', labelKey: 'seasonLanguagesDay' },
  { key: 'students-day', labelKey: 'seasonStudentsDay' },
] as const satisfies readonly { key: string; labelKey: MessageKey }[]

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
  startsInMinutes = 0,
): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/maintenance', {
    minutes,
    message: null,
    ...(startsInMinutes > 0 ? { startsInMinutes } : {}),
    ...(code ? { code } : {}),
  })
}

/**
 * Роли, которым можно адресовать объявление. Список короткий и выбирается тапом —
 * в отличие от вузов, которых сотня: их прицел задаётся из веба.
 */
export const BANNER_AUDIENCES = [
  { key: 'students', labelKey: 'roleStudent', roles: ['STUDENT', 'STAROSTA'] },
  { key: 'teachers', labelKey: 'roleTeacher', roles: ['TEACHER'] },
  {
    key: 'staff',
    labelKey: 'roleStaff',
    roles: ['DEAN', 'UNIVERSITY_ADMIN', 'UNIVERSITY_MODERATOR'],
  },
] as const

/**
 * Повесить или снять баннер. `custom` — свой текст вместо заготовки; сервер требует все
 * три языка, и это не придирка: строка на двух языках из трёх — дыра в интерфейсе у тех,
 * кому не повезло с локалью.
 */
export async function setBanner(
  minutes: number | null,
  preset?: (typeof BANNER_PRESETS)[number],
  roles: string[] = [],
  custom?: LocalizedText,
  level: 'INFO' | 'WARNING' = 'INFO',
): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/banner', {
    minutes,
    level: custom ? level : (preset?.level ?? 'INFO'),
    text: custom ?? preset?.text ?? null,
    roles,
  })
}

export async function setSections(disabled: string[]): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/sections', { disabled })
}

/**
 * Праздничное оформление. Состояние целиком: выключатель и подмена едут вместе, потому
 * что сервер хранит их одной строкой и половинчатое обновление стёрло бы вторую половину.
 */
export async function setSeason(off: boolean, override: string | null): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/season', { off, override })
}

export async function announceRelease(version: string | null): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/release', { version })
}

/** Настройки уведомлений команде. Отправляются целиком: это состояние, а не команда. */
export async function setNotifications(input: NotificationSettings): Promise<PlatformState> {
  return apiPatch<PlatformState>('/platform/notifications', input)
}

/**
 * Верни как было — откат последнего переключения рычагов.
 *
 * Чипы стоят рядом, палец один, и промах по экрану меняет то, что видят все. Сервер
 * откатывает только последнее изменение и только моложе получаса; включить техработы
 * откатом нельзя — на это есть своя кнопка, и она спрашивает код.
 */
export async function undoLastChange(): Promise<PlatformState> {
  return apiPost<PlatformState>('/platform/undo', {})
}

/**
 * Кто из команды привязал Telegram. Пул для очереди дежурств: дежурить может только тот,
 * кому бот в принципе может написать.
 */
export interface TeamLink {
  userId: string
  name: string
  role: string
  username: string | null
  linkedAt: string
  lastSeenAt: string | null
}

export async function fetchTeam(): Promise<TeamLink[]> {
  return apiGet<TeamLink[]>('/mini/links')
}

/** Очередь дежурств: кто сейчас и в каком порядке меняются. */
export interface Duty {
  dutyUserId: string | null
  rotation: string[]
}

export async function fetchDuty(): Promise<Duty> {
  return apiGet<Duty>('/platform/duty')
}

/**
 * Задать очередь. Порядок — тот, в котором люди отмечены: дежурство передаётся
 * следующему по списку каждый понедельник.
 */
export async function setDuty(rotation: string[]): Promise<Duty> {
  return apiPatch<Duty>('/platform/duty', { rotation })
}
