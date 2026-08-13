import { api } from '../../../shared/api'
import type { Activity } from '@studenthub/shared-schemas'

export const activityKeys = {
  all: ['activity'] as const,
  mine: (limit?: number) => ['activity', 'mine', limit ?? 30] as const,
}

// Единая лента активности пользователя (GET /me/activity, docs/UNIFIED_UX.md PR-9).
export async function fetchMyActivity(limit = 30): Promise<Activity[]> {
  const { data } = await api.get<Activity[]>('/me/activity', { params: { limit } })
  return data
}
