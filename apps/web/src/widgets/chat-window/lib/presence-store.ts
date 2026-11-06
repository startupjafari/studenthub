import { useSyncExternalStore } from 'react'
import type { PresenceEntry } from '../../../entities/chat'

type PresenceMap = ReadonlyMap<string, boolean>

/**
 * Присутствие участников открытого чата — вне состояния окна чатов (F-F12).
 *
 * Карта жила в useState окна и пополнялась любым `presence:changed`: каждый вход и выход
 * человека из вуза давал новый объект и перерисовку всего окна вместе с лентой, а счётчик
 * «в сети» в группе считал и посторонних. Теперь в карте только участники открытого чата
 * (снимок `GET /chats/:id/presence`), события о других отбрасываются, а компоненты читают
 * нужную им величину через `usePresence` и перерисовываются, только когда она меняется.
 */
export interface PresenceStore {
  /** Снимок участников чата заменяет карту целиком (смена чата, ответ сервера). */
  reset(entries: readonly PresenceEntry[] | undefined): void
  /** Событие `presence:changed`: применяется только к участникам открытого чата. */
  apply(userId: string, online: boolean): void
  subscribe(listener: () => void): () => void
  getSnapshot(): PresenceMap
}

export function createPresenceStore(): PresenceStore {
  let map: PresenceMap = new Map()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    reset(entries) {
      map = new Map((entries ?? []).map((e) => [e.userId, e.online]))
      notify()
    },
    apply(userId, online) {
      const prev = map.get(userId)
      if (prev === undefined || prev === online) return
      const next = new Map(map)
      next.set(userId, online)
      map = next
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => map,
  }
}

/** Собеседник личного чата — первый участник, кроме меня. */
export function peerIdOf(map: PresenceMap, myId: string | undefined): string | undefined {
  for (const id of map.keys()) if (id !== myId) return id
  return undefined
}

/** Сколько участников, кроме меня, сейчас в сети. */
export function othersOnlineCount(map: PresenceMap, myId: string | undefined): number {
  let count = 0
  for (const [id, online] of map) if (online && id !== myId) count += 1
  return count
}

/**
 * Величина из карты присутствия. `select` обязан возвращать примитив: компонент
 * перерисуется, только когда он изменится.
 */
export function usePresence<T extends string | number | boolean | undefined>(
  store: PresenceStore,
  select: (map: PresenceMap) => T,
): T {
  const read = (): T => select(store.getSnapshot())
  return useSyncExternalStore(store.subscribe, read, read)
}
