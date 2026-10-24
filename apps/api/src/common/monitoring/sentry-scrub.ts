import type { Breadcrumb, BreadcrumbHint, ErrorEvent, NodeOptions } from '@sentry/nestjs'
import { scrubBreadcrumbData, scrubSentryEvent, scrubUrl } from '@studenthub/shared-config'
import { LINK_PREVIEW_USER_AGENT } from '../link-preview/link-preview-agent'

// Тип события транзакции SDK наружу не экспортирует — берём из сигнатуры хука.
type TransactionEvent = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0]

// beforeSend-хук Sentry: последняя линия обороны перед отправкой события во внешний SaaS
// (docs/BACKEND_RULES.md §13, §14.9). Сама чистка — общая с web (`scrubSentryEvent` в
// @studenthub/shared-config), здесь только привязка к типам Node-SDK.

/** Чистит событие перед отправкой; `null` вернуть нечему — событие всегда отправляемо. */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  return scrubSentryEvent(event)
}

/** Исходящий запрос превью ссылки: адрес взят из личной переписки (§11.3). */
function isLinkPreviewRequest(hint: BreadcrumbHint | undefined): boolean {
  const request = hint?.request as { getHeader?: (name: string) => unknown } | undefined
  return request?.getHeader?.('user-agent') === LINK_PREVIEW_USER_AGENT
}

/**
 * beforeBreadcrumb: крошки копятся в памяти и уезжают с ближайшей ошибкой, поэтому чистятся
 * в момент записи, а не только в beforeSend. Запросы превью ссылок не пишутся вовсе — их
 * адрес и есть содержимое переписки; у остальных из адреса убираются секреты (токен бота
 * Telegram в пути `/bot<token>/`, `?t=`, `?token=`), а строка запроса отдельным полем — целиком.
 */
export function scrubBreadcrumb(crumb: Breadcrumb, hint?: BreadcrumbHint): Breadcrumb | null {
  if (crumb.category === 'http' && isLinkPreviewRequest(hint)) return null
  return crumb.data ? { ...crumb, data: scrubBreadcrumbData(crumb.data) } : crumb
}

/** Атрибуты спана, в которых OpenTelemetry держит адрес запроса. */
const SPAN_URL_KEYS = ['url', 'http.url', 'http.target', 'url.full', 'url.path'] as const

/**
 * beforeSendTransaction: транзакции (при включённом трейсинге) несут те же адреса — в имени,
 * в запросе и в каждом спане исходящего запроса (описание `POST https://…/bot<token>/…`).
 */
export function scrubTransaction(event: TransactionEvent): TransactionEvent | null {
  const scrubbed = scrubSentryEvent(event)
  if (scrubbed.spans) {
    scrubbed.spans = scrubbed.spans.map((span) => {
      // Описание как адрес чистим только у HTTP-спанов: у спанов БД там SQL.
      if (!span.op?.startsWith('http')) return span
      const data = { ...scrubBreadcrumbData(span.data) }
      for (const key of SPAN_URL_KEYS) {
        const value = data[key]
        if (typeof value === 'string') data[key] = scrubUrl(value)
      }
      delete data['url.query']
      return {
        ...span,
        data: data as typeof span.data,
        ...(span.description ? { description: scrubUrl(span.description) } : {}),
      }
    })
  }
  return scrubbed
}
