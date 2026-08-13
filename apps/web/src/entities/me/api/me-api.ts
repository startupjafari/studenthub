import { api } from '../../../shared/api'
import type { MeToday } from '../model/types'

// Ключи React Query для BFF-агрегаторов главных экранов.
export const meKeys = {
  all: ['me'] as const,
  today: () => ['me', 'today'] as const,
}

// Единый запрос операционного экрана «Сегодня» вместо нескольких доменных (docs/UNIFIED_UX.md PR-1).
export async function fetchMeToday(): Promise<MeToday> {
  const { data } = await api.get<MeToday>('/me/today')
  return data
}
