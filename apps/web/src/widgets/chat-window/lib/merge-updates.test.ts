import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatUpdates } from '../../../entities/chat'
import { latestSeqOf, mergeUpdates } from './merge-updates'

function message(id: string, seq: number, content = id): ChatMessage {
  return {
    id,
    chatId: 'c1',
    seq,
    senderId: 'u1',
    content,
    replyToId: null,
    forwardedFromId: null,
    editedAt: null,
    pinnedAt: null,
    createdAt: '2026-08-19T10:00:00.000Z',
    sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    linkPreview: null,
    media: [],
    replyTo: null,
    forwardedFrom: null,
    sharedPost: null,
    reactions: [],
    poll: null,
    systemType: null,
    systemMeta: null,
  }
}

function delta(patch: Partial<ChatUpdates> = {}): ChatUpdates {
  return { created: [], mutated: [], deletedIds: [], latestSeq: 0, overflow: false, ...patch }
}

describe('latestSeqOf', () => {
  it('пустой кэш → 0 (сервер отдаст всё с начала)', () => {
    expect(latestSeqOf(undefined)).toBe(0)
    expect(latestSeqOf([])).toBe(0)
  })

  it('берёт максимум, а не последний элемент', () => {
    expect(latestSeqOf([message('a', 3), message('b', 7), message('c', 5)])).toBe(7)
  })
})

describe('mergeUpdates', () => {
  it('пустая дельта не меняет ссылку на массив', () => {
    const cached = [message('a', 1)]
    expect(mergeUpdates(cached, delta())).toBe(cached)
  })

  it('дописывает новые сообщения в хвост', () => {
    const result = mergeUpdates([message('a', 1)], delta({ created: [message('b', 2)] }))
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('не дублирует сообщение, уже пришедшее по WS', () => {
    const cached = [message('a', 1), message('b', 2)]
    const result = mergeUpdates(cached, delta({ created: [message('b', 2)] }))
    expect(result.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('заменяет изменённое сообщение на серверную версию', () => {
    const edited = { ...message('a', 1, 'исправлено'), editedAt: '2026-08-19T11:00:00.000Z' }
    const result = mergeUpdates([message('a', 1, 'было')], delta({ mutated: [edited] }))
    expect(result[0]?.content).toBe('исправлено')
    expect(result[0]?.editedAt).toBe('2026-08-19T11:00:00.000Z')
  })

  it('убирает удалённые сообщения', () => {
    const cached = [message('a', 1), message('b', 2), message('c', 3)]
    const result = mergeUpdates(cached, delta({ deletedIds: ['b'] }))
    expect(result.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('удаление имеет приоритет над созданием того же сообщения', () => {
    const result = mergeUpdates(
      [message('a', 1)],
      delta({ created: [message('b', 2)], deletedIds: ['b'] }),
    )
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('работает на пустом кэше', () => {
    const result = mergeUpdates(undefined, delta({ created: [message('a', 1)] }))
    expect(result.map((m) => m.id)).toEqual(['a'])
  })

  it('не мутирует исходный массив', () => {
    const cached = [message('a', 1)]
    mergeUpdates(cached, delta({ created: [message('b', 2)], deletedIds: ['a'] }))
    expect(cached.map((m) => m.id)).toEqual(['a'])
  })
})
