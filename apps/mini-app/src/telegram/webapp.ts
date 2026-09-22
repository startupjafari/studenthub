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

/**
 * Открыто ли приложение внутри клиента Telegram, а не в обычной вкладке.
 *
 * Проверяем `platform`, а не наличие объекта: скрипт `telegram-web-app.js` создаёт
 * `window.Telegram.WebApp` в любом браузере и вне Telegram сообщает `platform: 'unknown'`.
 * Проверка «объект существует» была бы истинной всегда — и запасные ветки не включались бы
 * никогда.
 */
export function isTelegram(): boolean {
  const tg = webApp()
  return tg !== null && tg.platform !== 'unknown'
}

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
  if (!tg || !isTelegram()) return () => {}

  tg.ready()
  tg.expand()
  // Свайп вниз внутри скроллящегося списка иначе закрывает мини-апп — частая жалоба
  // на приложения, которые этот вызов пропустили. Метод появился в 7.7, отсюда `?.`.
  tg.disableVerticalSwipes?.()
  // Шапку и подложку красим в ФОН СТРАНИЦЫ, а не в bg_color: страница у нас лежит на
  // secondary_bg_color, и шапка цвета bg_color рисовала над приложением полосу другого
  // оттенка — мини-апп выглядел вставленным в чужую рамку.
  const surface = tg.themeParams.secondary_bg_color ?? tg.themeParams.bg_color ?? '#ffffff'
  tg.setHeaderColor?.(surface)
  tg.setBackgroundColor?.(surface)

  const onThemeChanged = (): void => {
    applyTheme(tg.themeParams, tg.colorScheme)
    const next = tg.themeParams.secondary_bg_color ?? tg.themeParams.bg_color ?? '#ffffff'
    tg.setHeaderColor?.(next)
    tg.setBackgroundColor?.(next)
  }
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

/**
 * Нативное подтверждение Telegram. Вне клиента — обычный confirm браузера, чтобы отладка
 * в вебе проходила тот же путь, а не в обход проверки.
 *
 * Возвращает промис: последовательность «спросили → дождались → сделали» читается сверху
 * вниз, тогда как колбэк разорвал бы её на два места.
 */
export function confirmAction(message: string): Promise<boolean> {
  const tg = webApp()
  if (!tg || !isTelegram()) return Promise.resolve(window.confirm(message))
  return new Promise((resolve) => tg.showConfirm(message, resolve))
}

/**
 * Параметр запуска (`?startapp=` в ссылке из уведомления): `complaint_<id>` или
 * `support_<id>`. Именно ради него уведомление вообще имеет кнопку — иначе человек,
 * которому написали «срочная жалоба», всё равно искал бы её в очереди руками.
 */
export function startParam(): { kind: 'complaint' | 'support'; id: string } | null {
  const raw = webApp()?.initDataUnsafe?.start_param
  if (!raw) return null
  const at = raw.indexOf('_')
  if (at <= 0) return null
  const kind = raw.slice(0, at)
  const id = raw.slice(at + 1)
  if (id.length === 0) return null
  return kind === 'complaint' || kind === 'support' ? { kind, id } : null
}

/**
 * Предупреждать ли при закрытии свайпом.
 *
 * Набранный ответ в поддержке или введённый код 2FA свайп вниз стирал молча — а набирают
 * их на телефоне долго. Включаем, только когда в полях что-то есть: постоянный вопрос
 * «точно закрыть?» на пустом экране учит отвечать «да» не глядя.
 */
export function setClosingConfirmation(on: boolean): void {
  const tg = webApp()
  if (!tg) return
  if (on) tg.enableClosingConfirmation?.()
  else tg.disableClosingConfirmation?.()
}
