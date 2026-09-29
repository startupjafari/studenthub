// Минимальная типизация window.Telegram.WebApp.
//
// Описываем РОВНО то, чем пользуемся, а не весь API: пакет-обёртка (@telegram-apps/sdk,
// @twa-dev/sdk) тянул бы зависимость ради полей, которые Telegram и так кладёт в window,
// и устаревал бы отдельно от клиента. Когда понадобится новое поле — дописывается сюда.
//
// Обычный модуль, а не `.d.ts`: типы отсюда импортируются по имени файла, а путь вида
// `./webapp.d` в bundler-резолвере не разрешается.

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

export interface TelegramThemeParams {
  bg_color?: string
  secondary_bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  header_bg_color?: string
  section_bg_color?: string
  section_separator_color?: string
  destructive_text_color?: string
}

interface TelegramButton {
  show: () => void
  hide: () => void
  onClick: (handler: () => void) => void
  offClick: (handler: () => void) => void
}

export interface TelegramMainButton extends TelegramButton {
  setText: (text: string) => void
  enable: () => void
  disable: () => void
  /** Цвет, активность и блик кнопки одним вызовом. Bot API 7.10. */
  setParams?: (params: TelegramBottomButtonParams) => void
  /** Крутилка на кнопке, пока запрос в пути. */
  showProgress?: (leaveActive?: boolean) => void
  hideProgress?: () => void
}

export interface TelegramBottomButtonParams {
  text?: string
  color?: string
  text_color?: string
  is_active?: boolean
  is_visible?: boolean
  has_shine_effect?: boolean
  /** Только у второстепенной: где она относительно главной. */
  position?: 'left' | 'right' | 'top' | 'bottom'
}

/** Отступы от краёв экрана: вырез, «полоска» жестов, панель Telegram в полноэкранном режиме. */
export interface TelegramInsets {
  top: number
  bottom: number
  left: number
  right: number
}

export interface TelegramPopupButton {
  id?: string
  type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive'
  text?: string
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: TelegramUser; start_param?: string }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  viewportStableHeight: number
  isExpanded: boolean
  ready: () => void
  expand: () => void
  close: () => void
  setHeaderColor?: (color: string) => void
  /** Подложка под приложением: видна при оттяжке списка за край. Bot API 6.1. */
  setBackgroundColor?: (color: string) => void
  disableVerticalSwipes?: () => void
  /** Спросить «точно закрыть?» на свайпе вниз. Включаем только при несохранённом вводе. */
  enableClosingConfirmation?: () => void
  disableClosingConfirmation?: () => void
  onEvent: (event: string, handler: () => void) => void
  offEvent: (event: string, handler: () => void) => void
  showAlert: (message: string, callback?: () => void) => void
  /**
   * Нативный лист с кнопками. В отличие от `showConfirm` у кнопки подтверждения есть
   * своя подпись и тип `destructive` — «Заблокировать» красным, а не безликое «OK».
   * Bot API 6.2.
   */
  showPopup?: (
    params: { title?: string; message: string; buttons?: TelegramPopupButton[] },
    callback?: (buttonId: string) => void,
  ) => void
  /** Сравнить версию клиента: новые методы вызываются только там, где они есть. */
  isVersionAtLeast?: (version: string) => boolean
  /** Полноэкранный режим без шапки Telegram. Bot API 8.0. */
  requestFullscreen?: () => void
  isFullscreen?: boolean
  safeAreaInset?: TelegramInsets
  contentSafeAreaInset?: TelegramInsets
  /** Цвет полосы под нижними кнопками. Bot API 7.10. */
  setBottomBarColor?: (color: string) => void
  /**
   * Открыть внешнюю ссылку средствами клиента. Своей вкладки у WebView мини-аппа нет:
   * переход внутри него уводит из приложения без пути назад.
   */
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
  /** Нативное подтверждение. `ok` — нажал ли человек согласие. */
  showConfirm: (message: string, callback: (ok: boolean) => void) => void
  MainButton: TelegramMainButton
  /** Вторая нативная кнопка рядом с главной. Bot API 7.10. */
  SecondaryButton?: TelegramMainButton
  BackButton: TelegramButton
  /** Пункт «Настройки» в меню «⋯» мини-аппа. Bot API 7.0. */
  SettingsButton?: TelegramButton
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}
