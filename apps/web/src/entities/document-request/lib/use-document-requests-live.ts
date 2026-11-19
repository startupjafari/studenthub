'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { documentRequestKeys } from '../api/document-request-api'

/**
 * Живые запросы документов (docs/PROJECT.md §9.2d, `document.changed`, entityId — id запроса).
 *
 * - `requested` / `closed` — адресатам запроса (вуз, группы, студенты): список «моих» запросов
 *   и прогресс группы у старосты;
 * - `submitted` — автору запроса: счётчики сданных в его списке и комплекты в карточке;
 * - `reviewed` — студенту: вердикт по его комплекту.
 *
 * Сигналы документов (`shared`, `issued`, …) слушает `useDocumentsLive`.
 */
export function useDocumentRequestsLive(enabled = true): void {
  useLiveRefresh(
    REALTIME_EVENTS.documentChanged,
    (envelope) => {
      const kind = (envelope.data as { kind?: string } | null)?.kind
      const id = envelope.entityId
      switch (kind) {
        case 'requested':
        case 'closed':
          return [
            documentRequestKeys.mine(),
            documentRequestKeys.detail(id),
            documentRequestKeys.groupProgress(),
          ]
        case 'submitted':
          // `authored` — префикс и списка-массива обзора, и страниц таблицы.
          return [documentRequestKeys.authored(), documentRequestKeys.manage(id)]
        case 'reviewed':
          return [documentRequestKeys.mine(), documentRequestKeys.detail(id)]
        default:
          return null
      }
    },
    { enabled },
  )
}
