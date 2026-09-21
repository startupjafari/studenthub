import { api } from '../../../shared/api'
import type { PlatformState } from '../model/state'

// Фабрика ключей React Query (FRONTEND_RULES §5.5).
export const platformKeys = {
  all: ['platform'] as const,
  state: () => [...platformKeys.all, 'state'] as const,
}

/** Публичный эндпоинт: работает и на странице логина, где токена ещё нет. */
export async function fetchPlatformState(): Promise<PlatformState> {
  const { data } = await api.get<PlatformState>('/platform/state')
  return data
}
