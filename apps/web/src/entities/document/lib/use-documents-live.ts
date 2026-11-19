'use client'

import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import { useLiveRefresh } from '../../../shared/realtime'
import { documentKeys } from '../api/document-api'

// Виды `document.changed`, которые меняют «Открытые мне» получателя доступа: грант выдан или
// отозван, владелец изменил или удалил документ.
const SHARED_KINDS = new Set(['shared', 'unshared', 'updated', 'deleted'])
// Виды, которые меняют собственные документы: вуз выдал справку, проверяющий вынес вердикт
// по запросу (статус документа — «принят» / «требует замены»).
const OWN_KINDS = new Set(['issued', 'reviewed'])

/**
 * Живые документы (docs/PROJECT.md §9.2d, `document.changed`). Сигналы запросов документов
 * (`requested`, `closed`, `submitted`) слушает `useDocumentRequestsLive` — у них свои ключи.
 * Своих сигналов владелец не получает: сервер исключает его из адресатов.
 */
export function useDocumentsLive(enabled = true): void {
  useLiveRefresh(
    REALTIME_EVENTS.documentChanged,
    (envelope) => {
      const kind = (envelope.data as { kind?: string } | null)?.kind
      if (!kind) return null
      // Пустой фильтр в ключе совпадает с любой страницей и сортировкой «Открытых мне».
      if (SHARED_KINDS.has(kind)) return [documentKeys.sharedWithMe({})]
      if (OWN_KINDS.has(kind)) return [documentKeys.all]
      return null
    },
    { enabled },
  )
}
