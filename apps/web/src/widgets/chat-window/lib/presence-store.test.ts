import { describe, expect, it, vi } from 'vitest'
import { createPresenceStore, othersOnlineCount, peerIdOf } from './presence-store'

describe('presence-store — присутствие открытого чата', () => {
  it('событие о постороннем для чата отбрасывается и никого не будит', () => {
    const store = createPresenceStore()
    store.reset([
      { userId: 'me', online: true },
      { userId: 'u2', online: false },
    ])
    const listener = vi.fn()
    store.subscribe(listener)

    store.apply('stranger', true)

    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot().has('stranger')).toBe(false)
  })

  it('событие об участнике меняет карту; повтор того же состояния — нет', () => {
    const store = createPresenceStore()
    store.reset([
      { userId: 'me', online: true },
      { userId: 'u2', online: false },
    ])
    const listener = vi.fn()
    store.subscribe(listener)

    store.apply('u2', true)
    const snapshot = store.getSnapshot()
    store.apply('u2', true)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(othersOnlineCount(snapshot, 'me')).toBe(1)
    expect(peerIdOf(snapshot, 'me')).toBe('u2')
  })

  it('снимок другого чата заменяет карту целиком', () => {
    const store = createPresenceStore()
    store.reset([{ userId: 'u2', online: true }])
    store.reset(undefined)
    expect(store.getSnapshot().size).toBe(0)
  })
})
