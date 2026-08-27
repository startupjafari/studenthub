import type { KatoScopeValue, KatoUnit } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export type { KatoUnit }

export const katoKeys = {
  all: ['kato'] as const,
  search: (search: string, scope: KatoScopeValue) => ['kato', 'search', scope, search] as const,
  // Ключ строится по отсортированным кодам: порядок в списке вузов меняется при сортировке
  // таблицы, а набор кодов тот же — иначе кэш промахивался бы на каждой пересортировке.
  resolve: (codes: string[]) => ['kato', 'resolve', [...codes].sort().join(',')] as const,
}

export async function searchKato(
  search: string,
  scope: KatoScopeValue = 'places',
  limit = 20,
): Promise<KatoUnit[]> {
  // Пустой `search` не отправляем: схема требует непустую строку, и `?search=` дал бы 422
  // на весь запрос. Отсутствие параметра — это осмысленный запрос «дай список по умолчанию».
  const { data } = await api.get<KatoUnit[]>('/kato', {
    params: { scope, limit, ...(search ? { search } : {}) },
  })
  return data
}

export async function resolveKato(codes: string[]): Promise<KatoUnit[]> {
  if (codes.length === 0) return []
  const { data } = await api.get<KatoUnit[]>('/kato/resolve', {
    params: { codes: codes.join(',') },
  })
  return data
}
