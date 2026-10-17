import { api } from '../../../shared/api'
import type { PlatformState } from '../model/state'

// Фабрика ключей React Query (FRONTEND_RULES §5.5).
export const platformKeys = {
  all: ['platform'] as const,
  // Ответ зависит от того, кто спрашивает (адресный баннер достаётся только адресату),
  // поэтому смотрящий — часть ключа: после входа состояние перезапрашивается сразу, а не
  // через минуту опроса, и чужой ответ не переживает смену пользователя во вкладке.
  state: (viewerId?: string | null) => [...platformKeys.all, 'state', viewerId ?? 'anon'] as const,
}

/**
 * Публичный эндпоинт: работает и на странице логина, где токена ещё нет. С токеном
 * (общий клиент подставляет его сам) сервер добавляет адресованные смотрящему баннеры.
 */
export async function fetchPlatformState(): Promise<PlatformState> {
  const { data } = await api.get<PlatformState>('/platform/state')
  return data
}
