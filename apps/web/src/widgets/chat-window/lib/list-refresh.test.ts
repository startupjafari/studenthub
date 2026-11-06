import { describe, expect, it } from 'vitest'
import type { ChatListItem, ChatMessage } from '../../../entities/chat'
import {
  mergeChatHead,
  withEditedMessage,
  withNewMessage,
  withOthersRead,
  withOwnRead,
} from './list-refresh'

function message(id: string, chatId: string, createdAt: string, content = id): ChatMessage {
  return {
    id,
    chatId,
    seq: 1,
    senderId: 'u2',
    content,
    replyToId: null,
    replyQuote: null,
    silent: false,
    forwardedFromId: null,
    editedAt: null,
    pinnedAt: null,
    createdAt,
    sender: { id: 'u2', firstName: 'A', lastName: 'B', avatarUrl: null },
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

function chat(id: string, updatedAt: string, over: Partial<ChatListItem> = {}): ChatListItem {
  return {
    id,
    type: 'GROUP',
    title: id,
    description: null,
    avatarUrl: null,
    subject: null,
    memberCount: 3,
    lastMessage: null,
    unread: false,
    unreadCount: 0,
    muted: false,
    mutedImportantOnly: false,
    pinned: false,
    pinnedAt: null,
    archived: false,
    draft: null,
    isOwner: false,
    isAdmin: false,
    blocked: false,
    blockedBy: false,
    online: false,
    othersReadAt: null,
    requestIncoming: false,
    requestOutgoing: false,
    updatedAt,
    ...over,
  }
}

const T = (h: number): string => `2026-10-01T${String(h).padStart(2, '0')}:00:00.000Z`

describe('mergeChatHead — первая страница поверх кэша', () => {
  it('строки страницы заменяют свои копии, строки ниже края остаются из кэша', () => {
    const cached = [chat('a', T(9)), chat('b', T(8)), chat('c', T(3)), chat('d', T(2))]
    const head = [chat('b', T(10), { unreadCount: 2, unread: true }), chat('a', T(9))]
    const merged = mergeChatHead(cached, head, false)
    expect(merged?.map((c) => c.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(merged?.[0]?.unreadCount).toBe(2)
  })

  it('чат, который лежал бы внутри страницы, но не пришёл, убирается (скрыт, удалён)', () => {
    const cached = [chat('a', T(9)), chat('gone', T(8)), chat('c', T(3))]
    const head = [chat('a', T(9)), chat('b', T(5))]
    expect(mergeChatHead(cached, head, false)?.map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('полная страница — это весь список', () => {
    const cached = [chat('a', T(9)), chat('old', T(1))]
    expect(mergeChatHead(cached, [chat('a', T(10))], true)?.map((c) => c.id)).toEqual(['a'])
  })

  it('пустую неполную страницу не сливает — нужен полный перезапрос', () => {
    expect(mergeChatHead([chat('a', T(9))], [], false)).toBeNull()
  })

  it('закреплённые остаются сверху', () => {
    const pinned = chat('p', T(1), { pinned: true, pinnedAt: T(1) })
    const merged = mergeChatHead([chat('a', T(9)), pinned], [chat('a', T(10))], false)
    expect(merged?.map((c) => c.id)).toEqual(['p', 'a'])
  })
})

describe('точечные правки строки по событию', () => {
  it('новое сообщение — превью и порядок сразу, счётчик не трогается', () => {
    const list = [chat('a', T(9)), chat('b', T(8), { unreadCount: 3, unread: true })]
    const next = withNewMessage(list, message('m1', 'b', T(11)))
    expect(next.map((c) => c.id)).toEqual(['b', 'a'])
    expect(next[0]).toMatchObject({ lastMessage: { id: 'm1' }, updatedAt: T(11), unreadCount: 3 })
  })

  it('запоздавшее старое сообщение превью не перетирает', () => {
    const list = [chat('a', T(9), { lastMessage: message('m2', 'a', T(9)) })]
    expect(withNewMessage(list, message('m1', 'a', T(8)))).toBe(list)
  })

  it('правка меняет превью, только если это последнее сообщение', () => {
    const list = [chat('a', T(9), { lastMessage: message('m2', 'a', T(9)) })]
    expect(withEditedMessage(list, message('m1', 'a', T(8), 'правка'))).toBe(list)
    const edited = withEditedMessage(list, message('m2', 'a', T(9), 'правка'))
    expect(edited[0]?.lastMessage?.content).toBe('правка')
  })

  it('прочтение собеседником двигает галочки только вперёд', () => {
    const list = [chat('a', T(9), { othersReadAt: T(9) })]
    expect(withOthersRead(list, 'a', T(8))).toBe(list)
    expect(withOthersRead(list, 'a', T(10))[0]?.othersReadAt).toBe(T(10))
  })

  it('своё прочтение до конца гасит счётчик на месте, иначе просит перезапрос', () => {
    const list = [
      chat('a', T(9), { lastMessage: message('m2', 'a', T(9)), unreadCount: 2, unread: true }),
    ]
    expect(withOwnRead(list, 'a', T(8))).toBeNull()
    expect(withOwnRead(list, 'x', T(10))).toBeNull()
    expect(withOwnRead(list, 'a', T(9))?.[0]).toMatchObject({ unreadCount: 0, unread: false })
  })
})
