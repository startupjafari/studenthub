import { locale, t } from '../i18n'

// Форматирование дат и длительностей. Один дом на всё приложение: до этого одинаковая
// функция `formatDate` лежала в трёх экранах по отдельности и уже начала расходиться.

const LOCALE_TAG = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' } as const

function tag(): string {
  return LOCALE_TAG[locale()]
}

export function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/** Только время для сегодняшнего, иначе дата: «14:30» без дня врёт о вчерашнем. */
export function formatShortTime(iso: string): string {
  const date = new Date(iso)
  return sameDay(date, new Date())
    ? date.toLocaleTimeString(tag(), { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(tag(), { day: 'numeric', month: 'short' })
}

/** Дата со временем — там, где важен и день, и час (срок техработ, открытие обращения). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString(tag(), {
    hour: '2-digit',
    minute: '2-digit',
    ...(sameDay(date, new Date()) ? {} : { day: 'numeric', month: 'short' }),
  })
}

/** Календарная дата без времени: «14 сентября 2025» — день регистрации, а не час. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(tag(), { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Заголовок группы в списке: «Сегодня», «Вчера» или дата. */
export function dayLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  if (sameDay(date, today)) return t('today')

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(date, yesterday)) return t('yesterday')

  return date.toLocaleDateString(tag(), { day: 'numeric', month: 'long' })
}

/**
 * Длительность в часах словами: «40 мин», «3 ч», «2 дн». Огрубляем так же, как возраст
 * в очереди: «3 ч 12 мин» отвечает на вопрос «быстро ли мы разбираем» не лучше, чем «3 ч».
 */
export function formatHours(hours: number): string {
  if (hours < 1) return t('ageMinutes', { count: Math.max(1, Math.round(hours * 60)) })
  if (hours < 24) return t('ageHours', { count: Math.round(hours) })
  return t('ageDays', { count: Math.round(hours / 24) })
}

/**
 * Сколько прошло: «40 мин», «3 ч», «2 дн». Огрубляем сознательно — «1 ч 47 мин»
 * отвечает на вопрос «давно ли» не лучше, чем «2 ч», а читается дольше.
 */
export function formatAge(since: number | string, now: number = Date.now()): string {
  const from = typeof since === 'string' ? new Date(since).getTime() : since
  const minutes = Math.max(0, Math.round((now - from) / 60_000))
  if (minutes < 60) return t('ageMinutes', { count: minutes })

  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('ageHours', { count: hours })

  return t('ageDays', { count: Math.round(hours / 24) })
}
