import type { SearchSource } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { SearchResults } from '../model/types'

export const searchKeys = {
  all: ['search'] as const,
  // Источники — часть ключа: выдача «только люди» не должна попасть в кэш полного поиска.
  query: (q: string, types?: readonly SearchSource[]) =>
    types ? (['search', 'query', q, types.join(',')] as const) : (['search', 'query', q] as const),
}

/**
 * `types` — искать только в этих источниках (остальные блоки ответа придут пустыми).
 * Без него — все шесть, как в палитре поиска.
 */
export async function fetchSearch(
  q: string,
  types?: readonly SearchSource[],
): Promise<SearchResults> {
  const params = types ? { q, types: types.join(',') } : { q }
  const { data } = await api.get<SearchResults>('/search', { params })
  return data
}
