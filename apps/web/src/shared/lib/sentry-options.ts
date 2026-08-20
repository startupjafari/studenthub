import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'
import { scrubBreadcrumbData, scrubSentryEvent } from '@studenthub/shared-config'

// Общие опции Sentry для web (Ф13.8). Один источник для трёх сред исполнения Next:
// браузер (instrumentation-client.ts), Node-сервер и edge (instrumentation.ts).
//
// Зачем вообще: все `error.tsx` показывают пользователю «Что-то пошло не так» и на этом
// всё — исключение умирало в браузере студента (§5.4). Теперь оно доезжает до трекера.

/**
 * DSN берётся из NEXT_PUBLIC_* — он нужен и в браузерном бандле, и это не секрет
 * (DSN только принимает события). Пустое значение = трекер выключен: Sentry.init
 * не вызывается вовсе, дев-сборка и e2e работают как раньше.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''

export const sentryEnabled = SENTRY_DSN.length > 0

// Тип не аннотирован намеренно: один и тот же объект расширяет опции трёх разных
// сборок SDK (browser/node/edge), и совместимость проверяется на месте вызова init.
export function sharedSentryOptions() {
  return {
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // §11.3: без IP, cookie и заголовков авторизации. Идентификатор пользователя
    // не проставляется вовсе — на фронте нет причины его знать, а вычислить
    // пострадавшего можно по requestId ответа API в хлебных крошках.
    sendDefaultPii: false,

    // Трейсинг производительности выключен: на пилоте нужны ошибки, а не профиль.
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0) || 0,

    // Session Replay сознательно НЕ подключён (в defaults SDK его и нет): это запись
    // экрана пользователя, т.е. чужая переписка, документы и оценки во внешнем сервисе
    // (§11.3). Включение — отдельное решение владельца: Sentry.replayIntegration({
    // maskAllText: true, blockAllMedia: true }) + replaysSessionSampleRate: 0.

    beforeSend: (event: ErrorEvent): ErrorEvent => scrubSentryEvent(event),

    // Хлебные крошки: URL fetch/xhr (`data.url`) И навигации (`data.from`/`data.to`)
    // могут содержать `?token=` — ссылку-приглашение или QR студенческого.
    // Чистим до попадания в событие.
    beforeBreadcrumb: (crumb: Breadcrumb): Breadcrumb =>
      crumb.data ? { ...crumb, data: scrubBreadcrumbData(crumb.data) } : crumb,

    // Шум, на который мы не можем повлиять и который не является нашей ошибкой.
    ignoreErrors: [
      // Пользователь ушёл со страницы во время запроса / оборвалась мобильная сеть.
      'AbortError',
      'Failed to fetch',
      'NetworkError',
      'Load failed',
      // Гонка навигации Next при быстром переходе между роутами.
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      // Расширения браузера и сторонние скрипты.
      /^ResizeObserver loop/,
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
    ],
  }
}
