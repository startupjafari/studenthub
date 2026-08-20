import type { ErrorEvent } from '@sentry/nestjs'
import { scrubSentryEvent } from '@studenthub/shared-config'

// beforeSend-хук Sentry: последняя линия обороны перед отправкой события во внешний SaaS
// (docs/BACKEND_RULES.md §13, §14.9). Сама чистка — общая с web (`scrubSentryEvent` в
// @studenthub/shared-config), здесь только привязка к типам Node-SDK.

/** Чистит событие перед отправкой; `null` вернуть нечему — событие всегда отправляемо. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubSentryEvent(event)
}
