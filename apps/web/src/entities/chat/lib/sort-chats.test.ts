import { describe, expect, it } from 'vitest'
import type { ChatListItem } from '../model/types'
import { sortChats } from './sort-chats'

function chat(
  id: string,
  updatedAt: string,
  pin?: { at: string; order?: number | null },
): ChatListItem {
  return {
    id,
    updatedAt,
    pinned: !!pin,
    pinnedAt: pin?.at ?? null,
    pinnedOrder: pin?.order ?? null,
  } as ChatListItem
}

const ids = (list: ChatListItem[]): string[] => list.map((c) => c.id)

describe('sortChats', () => {
  it('закреплённые сверху, остальные по свежести', () => {
    const list = [
      chat('old', '2025-01-01T00:00:00Z'),
      chat('pin', '2024-01-01T00:00:00Z', { at: '2025-01-02T00:00:00Z' }),
      chat('new', '2025-02-01T00:00:00Z'),
    ]
    expect(ids(sortChats(list))).toEqual(['pin', 'new', 'old'])
  })

  it('ручной порядок закреплённых важнее времени закрепления', () => {
    const list = [
      chat('a', '2025-01-01T00:00:00Z', { at: '2025-03-01T00:00:00Z', order: 1 }),
      chat('b', '2025-01-01T00:00:00Z', { at: '2025-01-01T00:00:00Z', order: 0 }),
    ]
    expect(ids(sortChats(list))).toEqual(['b', 'a'])
  })

  it('закреплённые без порядка — ниже упорядоченных, свежее закрепление выше', () => {
    const list = [
      chat('loose-old', '2025-01-01T00:00:00Z', { at: '2025-01-01T00:00:00Z' }),
      chat('loose-new', '2025-01-01T00:00:00Z', { at: '2025-02-01T00:00:00Z' }),
      chat('ordered', '2025-01-01T00:00:00Z', { at: '2024-01-01T00:00:00Z', order: 0 }),
    ]
    expect(ids(sortChats(list))).toEqual(['ordered', 'loose-new', 'loose-old'])
  })
})
