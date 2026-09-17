import { api } from '../../../shared/api'
import type { ReleaseSeen, ReleaseState } from '../model/state'

// Фабрика ключей React Query (FRONTEND_RULES §5.5).
export const releaseKeys = {
  all: ['releases'] as const,
  state: () => [...releaseKeys.all, 'state'] as const,
}

export async function fetchReleaseState(): Promise<ReleaseState> {
  const { data } = await api.get<ReleaseState>('/releases/me')
  return data
}

export async function markReleaseSeen(version: string): Promise<ReleaseSeen> {
  const { data } = await api.post<ReleaseSeen>('/releases/seen', { version })
  return data
}
