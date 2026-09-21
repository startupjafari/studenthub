/**
 * Ответ `GET /platform/state` — рычаги, которыми админ управляет вебом без деплоя.
 *
 * Сроки жизни уже применены сервером: приходит либо действующее объявление, либо `null`.
 * Клиент даты не сравнивает намеренно — на телефоне с уехавшими часами он показал бы
 * техработы, которых нет, или спрятал настоящие.
 */
export interface PlatformLocalizedText {
  ru: string
  kk: string
  en: string
}

export interface PlatformMaintenance {
  /** ISO-время окончания. Показываем человеку, чтобы он знал, когда возвращаться. */
  until: string
  message: PlatformLocalizedText | null
  /** Начало окна у плановых работ; null — начались сразу. */
  startsAt: string | null
  /** Уже идут. false — назначены на будущее: предупреждаем, но не закрываем. */
  active: boolean
}

export interface PlatformBanner {
  until: string
  level: 'INFO' | 'WARNING'
  text: PlatformLocalizedText
  /**
   * Кому показывать. Пустые массивы — всем.
   *
   * Фильтрует клиент, а не сервер: ответ `GET /platform/state` публичный и общий для всех,
   * и делать его персональным значило бы отказаться от кэша ради объявления, которое и
   * так не секрет. Прицел здесь — про уместность, а не про тайну.
   */
  roles: string[]
  universityIds: string[]
}

export interface PlatformState {
  maintenance: PlatformMaintenance | null
  banner: PlatformBanner | null
  /** Ключи погашенных разделов. Пустой массив — всё работает. */
  disabledSections: string[]
  announcedVersion: string | null
}

/** Состояние по умолчанию: платформа жива, объявлений нет. */
export const PLATFORM_STATE_DEFAULT: PlatformState = {
  maintenance: null,
  banner: null,
  disabledSections: [],
  announcedVersion: null,
}
