// Серверная инициализация Sentry для Next (Ф13.8): вызывается один раз на старте
// процесса — отдельно для node- и для edge-рантайма. Клиентская часть — в
// instrumentation-client.ts.
import * as Sentry from '@sentry/nextjs'
import { sentryEnabled, sharedSentryOptions } from 'shared/lib/sentry-options'

export function register(): void {
  if (!sentryEnabled) {
    return
  }
  // Опции одинаковы для обоих рантаймов; SDK сам подставляет нужную сборку.
  Sentry.init(sharedSentryOptions())
}

// Ошибки серверного рендера и Route Handlers (App Router отдаёт их этим хуком).
// Без него на сервере ловятся только необработанные исключения процесса.
export const onRequestError = Sentry.captureRequestError
