/// <reference types="vite/client" />

/**
 * Версия сборки. Подставляется `vite.config.ts` из package.json на этапе сборки —
 * читать package.json в рантайме нечем, а знать, какая сборка открыта, нужно: сервисы
 * на Railway однажды разъехались по веткам, и выяснилось это только по логам.
 */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Адрес бэкенда. По умолчанию `/api/v1` — прокси dev-сервера или тот же домен. */
  readonly VITE_API_URL?: string
  /**
   * Ссылка на мини-апп в Telegram — `https://t.me/<бот>/<приложение>`.
   *
   * Нужна кнопке «Поделиться»: коллеге отправляют ссылку, которая ОТКРЫВАЕТ карточку в
   * Telegram, а не адрес веб-страницы, на которую он попадёт без подписи initData и
   * увидит экран «откройте из Telegram». Имени бота клиент не знает — Telegram его в
   * initData не передаёт, поэтому оно приходит сборкой. Не задана — делимся тем, что
   * есть: адресом страницы.
   */
  readonly VITE_TG_APP_LINK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
