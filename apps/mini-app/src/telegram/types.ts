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
  disableVerticalSwipes?: () => void
  onEvent: (event: string, handler: () => void) => void
  offEvent: (event: string, handler: () => void) => void
  showAlert: (message: string, callback?: () => void) => void
  MainButton: TelegramMainButton
  BackButton: TelegramButton
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
