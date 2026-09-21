import type { TelegramThemeParams, TelegramWebApp } from './types'

// Доступ к Telegram и перенос его темы в CSS-переменные.
//
// Ключевое решение: приложение обязано работать и в обычном браузере. Мини-апп открывают
// в браузере на каждой второй отладке, и падение на `window.Telegram.WebApp.ready()`
// превращает разработку в «проверяй только через телефон». Поэтому единственная точка
// доступа — `webApp()`, возвращающая `null` вне Telegram, а вся работа с кнопками и
// хаптикой безопасна при её отсутствии.

export function webApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

/** Открыто ли приложение внутри клиента Telegram, а не в обычной вкладке. */
export const isTelegram = (): boolean => webApp() !== null

/**
 * Инициализация: сообщить Telegram, что каркас отрисован, развернуть на всю высоту
 * и синхронизировать тему.
 *
 * `ready()` важнее, чем кажется: до него Telegram держит поверх приложения свой
 * плейсхолдер загрузки, и пользователь видит пустоту вместо экрана.
 */
export function initTelegram(): () => void {
  const tg = webApp()
  applyTheme(tg?.themeParams ?? {}, tg?.colorScheme ?? 'light')
  if (!tg) return () => {}

  tg.ready()
  tg.expand()
  // Свайп вниз внутри скроллящегося списка иначе закрывает мини-апп — частая жалоба
  // на приложения, которые этот вызов пропустили. Метод появился в 7.7, отсюда `?.`.
  tg.disableVerticalSwipes?.()
  tg.setHeaderColor?.(tg.themeParams.bg_color ?? '#ffffff')

  const onThemeChanged = (): void => applyTheme(tg.themeParams, tg.colorScheme)
  tg.onEvent('themeChanged', onThemeChanged)
  return () => tg.offEvent('themeChanged', onThemeChanged)
}

/**
 * Тема Telegram → CSS-переменные.
 *
 * Клиент отдаёт цвета объектом, а не переменными, и меняет их на лету (пользователь
 * переключил тему, не закрывая мини-апп). Раскладываем их в `:root` один раз, а стили
 * пишем только через переменные — тогда смена темы не требует перерисовки React.
 * Значения по умолчанию нужны для запуска вне Telegram.
 */
function applyTheme(params: TelegramThemeParams, scheme: 'light' | 'dark'): void {
  const dark = scheme === 'dark'
  const fallback: Required<TelegramThemeParams> = {
    bg_color: dark ? '#17212b' : '#ffffff',
    secondary_bg_color: dark ? '#0e1621' : '#f0f0f0',
    section_bg_color: dark ? '#17212b' : '#ffffff',
    section_separator_color: dark ? '#0e1621' : '#e7e7e7',
    text_color: dark ? '#f5f5f5' : '#000000',
    hint_color: dark ? '#708499' : '#707579',
    link_color: dark ? '#6ab3f3' : '#2481cc',
    button_color: dark ? '#5288c1' : '#2481cc',
    button_text_color: '#ffffff',
    header_bg_color: dark ? '#17212b' : '#ffffff',
    destructive_text_color: dark ? '#ec3942' : '#df3f40',
  }

  // Идём по ключам запасной палитры, а не по спреду `{ ...fallback, ...params }`: клиент
  // может прислать поле пустым, и спред затёр бы им готовый цвет — получилась бы переменная
  // без значения, то есть невидимый текст.
  const root = document.documentElement
  for (const key of Object.keys(fallback) as (keyof TelegramThemeParams)[]) {
    const value = params[key] || fallback[key]
    root.style.setProperty(`--tg-theme-${key.replaceAll('_', '-')}`, value)
  }
  root.style.colorScheme = scheme
}

/** Тактильный отклик. Вне Telegram — тишина, а не исключение. */
export const haptic = {
  tap: (): void => webApp()?.HapticFeedback.impactOccurred('light'),
  select: (): void => webApp()?.HapticFeedback.selectionChanged(),
  success: (): void => webApp()?.HapticFeedback.notificationOccurred('success'),
}
