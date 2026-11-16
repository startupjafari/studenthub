import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessageLocation } from '../model/types'
import { applyLocationUpdate, isLiveLocation, liveUpdatedMinutesAgo } from './live-location'

const NOW = Date.parse('2026-11-12T10:00:00.000Z')

function loc(patch: Partial<MessageLocation> = {}): MessageLocation {
  return { lat: 43.2, lng: 76.9, title: null, address: null, ...patch }
}

describe('isLiveLocation', () => {
  it('обычная точка и точка старого сервера — не трансляция', () => {
    expect(isLiveLocation(loc(), NOW)).toBe(false)
    expect(isLiveLocation(loc({ liveUntil: null }), NOW)).toBe(false)
  })

  it('срок в будущем — трансляция идёт', () => {
    expect(isLiveLocation(loc({ liveUntil: '2026-11-12T10:15:00.000Z' }), NOW)).toBe(true)
  })

  it('срок наступил (остановка ставит liveUntil = now) или прошёл — обычная точка', () => {
    expect(isLiveLocation(loc({ liveUntil: '2026-11-12T10:00:00.000Z' }), NOW)).toBe(false)
    expect(isLiveLocation(loc({ liveUntil: '2026-11-12T09:00:00.000Z' }), NOW)).toBe(false)
  })

  it('битая дата — не трансляция', () => {
    expect(isLiveLocation(loc({ liveUntil: 'не дата' }), NOW)).toBe(false)
  })
})

describe('liveUpdatedMinutesAgo', () => {
  it('без отметки — null', () => {
    expect(liveUpdatedMinutesAgo(loc(), NOW)).toBeNull()
  })

  it('считает полные минуты', () => {
    expect(liveUpdatedMinutesAgo(loc({ liveUpdatedAt: '2026-11-12T09:59:30.000Z' }), NOW)).toBe(0)
    expect(liveUpdatedMinutesAgo(loc({ liveUpdatedAt: '2026-11-12T09:57:10.000Z' }), NOW)).toBe(2)
    expect(liveUpdatedMinutesAgo(loc({ liveUpdatedAt: '2026-11-12T08:30:00.000Z' }), NOW)).toBe(90)
  })

  it('часы клиента отстают — не уходит в минус', () => {
    expect(liveUpdatedMinutesAgo(loc({ liveUpdatedAt: '2026-11-12T10:05:00.000Z' }), NOW)).toBe(0)
  })
})

describe('applyLocationUpdate', () => {
  const message = (id: string, chatId: string): ChatMessage =>
    ({ id, chatId, location: loc() }) as unknown as ChatMessage
  const next = loc({ lat: 1, lng: 2, liveUntil: '2026-11-12T11:00:00.000Z' })

  it('кладёт точку в своё сообщение', () => {
    const list = [message('m1', 'c1'), message('m2', 'c1')]
    const out = applyLocationUpdate(list, { chatId: 'c1', messageId: 'm2', location: next })
    expect(out?.[1]?.location).toEqual(next)
    expect(out?.[0]).toBe(list[0])
  })

  it('сообщение другого чата не трогает и отдаёт тот же массив', () => {
    const list = [message('m1', 'c1')]
    expect(applyLocationUpdate(list, { chatId: 'c2', messageId: 'm1', location: next })).toBe(list)
    expect(applyLocationUpdate(list, { chatId: 'c1', messageId: 'zz', location: next })).toBe(list)
  })

  it('незагруженная лента остаётся незагруженной', () => {
    expect(
      applyLocationUpdate(undefined, { chatId: 'c1', messageId: 'm1', location: next }),
    ).toBeUndefined()
  })
})
