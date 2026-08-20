// Инициализация Sentry в браузере (Ф13.8). Next подхватывает этот файл автоматически
// и грузит его до кода приложения. Без NEXT_PUBLIC_SENTRY_DSN не делаем ничего:
// в dev и в e2e трекер молчит.
import * as Sentry from '@sentry/nextjs'
import { sentryEnabled, sharedSentryOptions } from 'shared/lib/sentry-options'

if (sentryEnabled) {
  Sentry.init(sharedSentryOptions())
}

// Обязателен для корректной привязки ошибок к переходам App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
