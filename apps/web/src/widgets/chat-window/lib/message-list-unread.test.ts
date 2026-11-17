import { describe, expect, it } from 'vitest'
import type { ChatAttentionQueue, ChatListItem } from '../../../entities/chat'
import {
  isQueueStale,
  pendingTargets,
  withAttentionCounts,
  withAttentionRead,
} from './message-list-unread'

const queue = (ids: string[], count = ids.length): ChatAttentionQueue => ({
  items: ids.map((messageId, i) => ({
    messageId,
    seq: i + 1,
    createdAt: `2026-11-17T10:0${i}:00.000Z`,
  })),
  count,
})

const chat = (id: string, m?: number, r?: number) =>
  ({ id, unreadMentionsCount: m, unreadReactionsCount: r }) as unknown as ChatListItem

describe('pendingTargets', () => {
  it('отдаёт очередь по порядку без прочитанного здесь', () => {
    expect(pendingTargets(queue(['a', 'b', 'c']), new Set(['b']))).toEqual(['a', 'c'])
  })

  it('без очереди целей нет', () => {
    expect(pendingTargets(undefined, new Set())).toEqual([])
  })
})

describe('isQueueStale', () => {
  it('эхо своего прочтения — очередь свежая', () => {
    expect(isQueueStale(1, queue(['a', 'b']), new Set(['a']))).toBe(false)
  })

  it('пришло новое или прочитали на другом устройстве — устарела', () => {
    expect(isQueueStale(3, queue(['a', 'b']), new Set())).toBe(true)
    expect(isQueueStale(0, queue(['a', 'b']), new Set())).toBe(true)
  })

  it('очередь обрезана сервером — сверяем по count, а не по длине', () => {
    expect(isQueueStale(150, queue(['a', 'b'], 150), new Set())).toBe(false)
  })

  it('очереди ещё нет — нужна, только если есть что показать', () => {
    expect(isQueueStale(2, undefined, new Set())).toBe(true)
    expect(isQueueStale(0, undefined, new Set())).toBe(false)
  })
})

describe('withAttentionCounts / withAttentionRead', () => {
  it('пишет счётчики только нужному чату и не пересоздаёт список без изменений', () => {
    const list = [chat('c1', 1, 0), chat('c2', 2, 3)]
    const next = withAttentionCounts(list, 'c2', { unreadMentionsCount: 0 })
    expect(next[1]).toMatchObject({ unreadMentionsCount: 0, unreadReactionsCount: 3 })
    expect(next[0]).toBe(list[0])
    expect(withAttentionCounts(list, 'c1', { unreadMentionsCount: 1 })).toBe(list)
  })

  it('старый сервер без полей — считаем нулями', () => {
    const list = [chat('c1')]
    expect(withAttentionCounts(list, 'c1', { unreadReactionsCount: 0 })).toBe(list)
    expect(withAttentionCounts(list, 'c1', { unreadReactionsCount: 2 })[0]).toMatchObject({
      unreadMentionsCount: 0,
      unreadReactionsCount: 2,
    })
  })

  it('оптимистичное прочтение уменьшает счётчик, но не ниже нуля', () => {
    const list = [chat('c1', 2, 1)]
    expect(withAttentionRead(list, 'c1', 'unreadMentionsCount', 1)[0]).toMatchObject({
      unreadMentionsCount: 1,
    })
    expect(withAttentionRead(list, 'c1', 'unreadReactionsCount', 5)[0]).toMatchObject({
      unreadReactionsCount: 0,
    })
    expect(withAttentionRead(list, 'c1', 'unreadMentionsCount', 'all')[0]).toMatchObject({
      unreadMentionsCount: 0,
      unreadReactionsCount: 1,
    })
    expect(withAttentionRead(list, 'nope', 'unreadMentionsCount', 1)).toBe(list)
  })
})
