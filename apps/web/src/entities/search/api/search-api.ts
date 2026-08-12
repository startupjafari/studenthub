import { api } from '../../../shared/api'
import type { SearchResults } from '../model/types'

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => ['search', 'query', q] as const,
}

export async function fetchSearch(q: string): Promise<SearchResults> {
  const { data } = await api.get<SearchResults>('/search', { params: { q } })
  return data
}
