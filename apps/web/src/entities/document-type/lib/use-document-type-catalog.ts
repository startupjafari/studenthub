'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { DOCUMENT_TYPES, documentTypeDef } from '@studenthub/shared-config'
import {
  documentTypeKeys,
  fetchEffectiveDocumentTypes,
  type EffectiveDocumentType,
} from '../api/document-type-api'

// Статический справочник в форме ответа API — запасной вариант, если каталог вуза не
// загрузился: выбор типа не должен исчезать из-за одного упавшего запроса. Тип всё равно
// проверит сервер по каталогу вуза.
const STATIC_CATALOG: EffectiveDocumentType[] = DOCUMENT_TYPES.map((d) => ({
  typeId: d.id,
  category: d.category,
  fields: [...d.fields],
  custom: false,
  enabled: true,
  retentionDays: null,
  label: null,
}))

/**
 * Каталог типов документов вуза пользователя (D-F09): статические типы с правками вуза плюс
 * собственные типы. В `types` — только включённые, их и предлагаем в выборе: выключенный тип
 * сервер отклонит уже после загрузки файлов. `typeOf`/`labelOf` знают и выключенные типы —
 * у уже загруженного документа такого типа название должно остаться.
 */
export function useDocumentTypeCatalog() {
  const t = useTranslations('Documents')
  const q = useQuery({
    queryKey: documentTypeKeys.effective(),
    queryFn: fetchEffectiveDocumentTypes,
    // Вуз правит каталог редко — перезапрашивать при каждом открытии мастера незачем.
    staleTime: 5 * 60 * 1000,
  })

  const all = q.data ?? (q.isError ? STATIC_CATALOG : [])
  const byId = new Map(all.map((d) => [d.typeId, d]))

  return {
    types: all.filter((d) => d.enabled),
    isPending: q.isPending,
    typeOf: (typeId: string): EffectiveDocumentType | undefined => byId.get(typeId),
    // У собственного типа вуза название задаёт вуз, у статического — словарь. Неизвестный
    // код (каталог ещё грузится, тип удалён) показываем как есть, а не ключом словаря.
    labelOf: (typeId: string): string => {
      const def = byId.get(typeId)
      if (def?.custom) return def.label ?? def.typeId
      return documentTypeDef(typeId) ? t(`docType_${typeId}`) : typeId
    },
  }
}
