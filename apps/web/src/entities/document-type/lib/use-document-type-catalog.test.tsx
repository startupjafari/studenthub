import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENT_TYPES } from '@studenthub/shared-config'
import { useDocumentTypeCatalog } from './use-document-type-catalog'
import { fetchEffectiveDocumentTypes, type EffectiveDocumentType } from '../api/document-type-api'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => `t:${key}` }))
vi.mock('../api/document-type-api', async (orig) => {
  const actual = await orig<typeof import('../api/document-type-api')>()
  return { ...actual, fetchEffectiveDocumentTypes: vi.fn() }
})

const fetchMock = vi.mocked(fetchEffectiveDocumentTypes)

const row = (over: Partial<EffectiveDocumentType>): EffectiveDocumentType => ({
  typeId: 'ID_CARD',
  category: 'PERSONAL',
  fields: ['number'],
  custom: false,
  enabled: true,
  retentionDays: null,
  label: null,
  ...over,
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children)
  return renderHook(() => useDocumentTypeCatalog(), { wrapper }).result
}

describe('useDocumentTypeCatalog (D-F09)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('в выборе — только включённые типы вуза, включая собственные', async () => {
    fetchMock.mockResolvedValue([
      row({ typeId: 'ID_CARD', enabled: false }),
      row({ typeId: 'PASSPORT' }),
      row({ typeId: 'UNI_PASS', custom: true, label: 'Пропуск в кампус', fields: ['comment'] }),
    ])
    const result = setup()
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.types.map((d) => d.typeId)).toEqual(['PASSPORT', 'UNI_PASS'])
    expect(result.current.labelOf('UNI_PASS')).toBe('Пропуск в кампус')
    // Выключенный тип из выбора убран, но у уже загруженного документа название остаётся.
    expect(result.current.labelOf('ID_CARD')).toBe('t:docType_ID_CARD')
    expect(result.current.typeOf('UNI_PASS')?.fields).toEqual(['comment'])
    // Неизвестный код — как есть, а не ключом словаря.
    expect(result.current.labelOf('GONE_TYPE')).toBe('GONE_TYPE')
  })

  it('каталог не загрузился — выбор из статического справочника', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const result = setup()
    await waitFor(() => expect(result.current.isPending).toBe(false))

    expect(result.current.types).toHaveLength(DOCUMENT_TYPES.length)
    expect(result.current.types.every((d) => d.enabled && !d.custom)).toBe(true)
  })
})
