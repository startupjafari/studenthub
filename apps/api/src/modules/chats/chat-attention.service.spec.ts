import { ChatAttentionKind, ChatType } from '@prisma/client'
import { ChatAttentionService, CHAT_ATTENTION_EVENT } from './chat-attention.service'
import { mentionTokens, mentionsName } from './chat-mentions'
import type { AttentionMessage } from './chat-attention.types'

function setup() {
  const prisma = {
    chatMember: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
    },
    chat: { findUnique: jest.fn().mockResolvedValue({ type: ChatType.GROUP }) },
    message: { findFirst: jest.fn() },
    messageReaction: { findFirst: jest.fn().mockResolvedValue(null) },
    chatAttention: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  }
  const realtime = { emitToUser: jest.fn() }
  const chats = {
    registerAttentionHook: jest.fn(),
    assertMembership: jest.fn().mockResolvedValue(undefined),
    visibleMessagesWhere: jest
      .fn()
      .mockResolvedValue({ chatId: 'c1', deletedAt: null, hiddenBy: { none: { userId: 'me' } } }),
  }
  const service = new ChatAttentionService(prisma as never, realtime as never, chats as never)
  return { service, prisma, realtime, chats }
}

function msg(over: Partial<AttentionMessage> = {}): AttentionMessage {
  return {
    id: 'msg1',
    senderId: 'author',
    content: '',
    systemType: null,
    forwardedFromId: null,
    replyTo: null,
    ...over,
  }
}

const ivanov = { userId: 'u-ivanov', user: { firstName: 'Иван', lastName: 'Иванов' } }
const petrova = { userId: 'u-petrova', user: { firstName: 'Анна', lastName: 'Петрова' } }

describe('chat-mentions', () => {
  it('находит упоминание в обоих порядках и без учёта регистра', () => {
    const u = { firstName: 'Иван', lastName: 'Иванов' }
    expect(mentionsName('привет, @Иванов Иван!', u)).toBe(true)
    expect(mentionsName('@иван иванов, глянь', u)).toBe(true)
    expect(mentionsName('Иванов Иван без собаки', u)).toBe(false)
    expect(mentionsName('@Иванов Пётр', u)).toBe(false)
  })

  it('берёт первое слово после каждого @ без повторов', () => {
    expect(mentionTokens('@Иванов Иван и @Петрова Анна, @иванов')).toEqual(['иванов', 'петрова'])
    expect(mentionTokens('почта a@ и @ просто')).toEqual([])
  })
})

describe('ChatAttentionService', () => {
  it('регистрирует себя хуком сервиса чатов', () => {
    const { service, chats } = setup()
    service.onModuleInit()
    expect(chats.registerAttentionHook).toHaveBeenCalledWith(service)
  })

  describe('mentionedUserIds', () => {
    it('в личном чате и «Сохранённых» упоминаний нет', async () => {
      const { service, prisma } = setup()
      const m = msg({ content: '@Иванов Иван', replyTo: { senderId: 'u-ivanov' } })
      await expect(service.mentionedUserIds('c1', ChatType.PRIVATE, m)).resolves.toEqual([])
      await expect(service.mentionedUserIds('c1', ChatType.SAVED, m)).resolves.toEqual([])
      expect(prisma.chatMember.findMany).not.toHaveBeenCalled()
    })

    it('служебные и пересланные сообщения никого не упоминают', async () => {
      const { service } = setup()
      const reply = { senderId: 'u-ivanov' }
      await expect(
        service.mentionedUserIds('c1', ChatType.GROUP, msg({ systemType: 'pin', replyTo: reply })),
      ).resolves.toEqual([])
      await expect(
        service.mentionedUserIds(
          'c1',
          ChatType.GROUP,
          msg({ forwardedFromId: 'src', replyTo: reply }),
        ),
      ).resolves.toEqual([])
    })

    it('по имени — только точное совпадение среди кандидатов, ответ — автору исходного', async () => {
      const { service, prisma } = setup()
      prisma.chatMember.findMany
        // Кандидаты по первому слову: «Иванов» подходит, «Иванова» — нет.
        .mockResolvedValueOnce([
          ivanov,
          { userId: 'u-ivanova', user: { firstName: 'Ирина', lastName: 'Иванова' } },
        ])
        // Действующие участники среди найденных.
        .mockImplementationOnce(({ where }: { where: { userId: { in: string[] } } }) =>
          Promise.resolve(where.userId.in.map((userId) => ({ userId }))),
        )
      const ids = await service.mentionedUserIds(
        'c1',
        ChatType.GROUP,
        msg({ content: 'сдайте, @Иванов Иван', replyTo: { senderId: 'u-petrova' } }),
      )
      expect(new Set(ids)).toEqual(new Set(['u-ivanov', 'u-petrova']))
      const candidatesQuery = prisma.chatMember.findMany.mock.calls[0]?.[0] as {
        where: { userId: unknown; bannedAt: unknown }
        take: number
      }
      expect(candidatesQuery.where.userId).toEqual({ not: 'author' })
      expect(candidatesQuery.where.bannedAt).toBeNull()
      expect(candidatesQuery.take).toBeGreaterThan(0)
    })

    it('ответ на своё сообщение — не упоминание; вышедший адресат отсеивается', async () => {
      const { service, prisma } = setup()
      await expect(
        service.mentionedUserIds('c1', ChatType.GROUP, msg({ replyTo: { senderId: 'author' } })),
      ).resolves.toEqual([])
      // Адресат ответа уже не участник.
      prisma.chatMember.findMany.mockResolvedValueOnce([])
      await expect(
        service.mentionedUserIds('c1', ChatType.GROUP, msg({ replyTo: { senderId: 'gone' } })),
      ).resolves.toEqual([])
    })
  })

  it('новое сообщение с упоминанием — строка MENTION и событие адресату', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatMember.findMany.mockResolvedValueOnce([ivanov]).mockResolvedValueOnce([ivanov])
    prisma.chatAttention.groupBy.mockResolvedValue([
      { chatId: 'c1', kind: ChatAttentionKind.MENTION, _count: { _all: 2 } },
    ])
    await service.onMessageSent({
      chatId: 'c1',
      chatType: ChatType.GROUP,
      message: msg({ content: '@Иванов Иван' }),
    })
    expect(prisma.chatAttention.createMany).toHaveBeenCalledWith({
      data: [
        { chatId: 'c1', userId: 'u-ivanov', messageId: 'msg1', kind: ChatAttentionKind.MENTION },
      ],
      skipDuplicates: true,
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u-ivanov', CHAT_ATTENTION_EVENT, {
      chatId: 'c1',
      unreadMentionsCount: 2,
      unreadReactionsCount: 0,
    })
  })

  it('сообщение без упоминаний ничего не пишет', async () => {
    const { service, prisma, realtime } = setup()
    await service.onMessageSent({
      chatId: 'c1',
      chatType: ChatType.GROUP,
      message: msg({ content: 'просто текст' }),
    })
    expect(prisma.chatAttention.createMany).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
  })

  it('правка: новому упомянутому — непрочитанное, убранному — снимается, прежнего не трогает', async () => {
    const { service, prisma, realtime } = setup()
    // mentionedUserIds(новый текст) и mentionedUserIds(прежний) идут параллельно: отвечаем
    // по тексту запроса, а не по порядку вызовов.
    prisma.chatMember.findMany.mockImplementation(
      ({ where }: { where: { user?: { OR: { lastName?: { startsWith: string } }[] } } }) => {
        if (where.user) {
          const tokens = where.user.OR.flatMap((c) => (c.lastName ? [c.lastName.startsWith] : []))
          return Promise.resolve(
            [ivanov, petrova].filter((m) => tokens.includes(m.user.lastName.toLowerCase())),
          )
        }
        return Promise.resolve(
          (where as { userId: { in: string[] } }).userId.in.map((userId) => ({ userId })),
        )
      },
    )
    prisma.chatAttention.findMany.mockResolvedValue([{ userId: 'u-ivanov' }])
    await service.onMessageEdited({
      chatId: 'c1',
      previousContent: '@Иванов Иван, привет',
      message: msg({ content: '@Петрова Анна, привет' }),
    })
    expect(prisma.chatAttention.createMany).toHaveBeenCalledWith({
      data: [
        { chatId: 'c1', userId: 'u-petrova', messageId: 'msg1', kind: ChatAttentionKind.MENTION },
      ],
      skipDuplicates: true,
    })
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: { messageId: 'msg1', kind: ChatAttentionKind.MENTION, userId: { in: ['u-ivanov'] } },
    })
    const notified = realtime.emitToUser.mock.calls.map((c) => c[0])
    expect(new Set(notified)).toEqual(new Set(['u-ivanov', 'u-petrova']))
  })

  describe('реакции', () => {
    it('чужая реакция на моё сообщение — непрочитанная REACTION у автора', async () => {
      const { service, prisma, realtime } = setup()
      prisma.message.findFirst.mockResolvedValue({ senderId: 'author', systemType: null })
      await service.onReactionChanged({
        chatId: 'c1',
        messageId: 'msg1',
        reactorId: 'u-ivanov',
        added: true,
      })
      expect(prisma.chatAttention.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_messageId_kind: {
              userId: 'author',
              messageId: 'msg1',
              kind: ChatAttentionKind.REACTION,
            },
          },
        }),
      )
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'author',
        CHAT_ATTENTION_EVENT,
        expect.objectContaining({ chatId: 'c1' }),
      )
    })

    it('своя реакция на своё сообщение ничего не создаёт', async () => {
      const { service, prisma } = setup()
      prisma.message.findFirst.mockResolvedValue({ senderId: 'author', systemType: null })
      await service.onReactionChanged({
        chatId: 'c1',
        messageId: 'msg1',
        reactorId: 'author',
        added: true,
      })
      expect(prisma.chatAttention.upsert).not.toHaveBeenCalled()
    })

    it('автор вышел из чата — непрочитанной реакции не будет', async () => {
      const { service, prisma } = setup()
      prisma.message.findFirst.mockResolvedValue({ senderId: 'author', systemType: null })
      prisma.chatMember.findFirst.mockResolvedValue(null)
      await service.onReactionChanged({
        chatId: 'c1',
        messageId: 'msg1',
        reactorId: 'u-ivanov',
        added: true,
      })
      expect(prisma.chatAttention.upsert).not.toHaveBeenCalled()
    })

    it('сняли последнюю чужую реакцию — непрочитанное уходит; остались другие — остаётся', async () => {
      const { service, prisma } = setup()
      prisma.message.findFirst.mockResolvedValue({ senderId: 'author', systemType: null })
      prisma.messageReaction.findFirst.mockResolvedValueOnce({ id: 'r2' })
      await service.onReactionChanged({
        chatId: 'c1',
        messageId: 'msg1',
        reactorId: 'u-ivanov',
        added: false,
      })
      expect(prisma.chatAttention.deleteMany).not.toHaveBeenCalled()

      prisma.messageReaction.findFirst.mockResolvedValueOnce(null)
      await service.onReactionChanged({
        chatId: 'c1',
        messageId: 'msg1',
        reactorId: 'u-ivanov',
        added: false,
      })
      expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'author', messageId: 'msg1', kind: ChatAttentionKind.REACTION },
      })
    })
  })

  it('удаление сообщений снимает их строки и обновляет счётчики затронутым', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatAttention.findMany.mockResolvedValue([
      { userId: 'a' },
      { userId: 'a' },
      { userId: 'b' },
    ])
    await service.onMessagesGone({ chatId: 'c1', messageIds: ['m1', 'm2'] })
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', messageId: { in: ['m1', 'm2'] } },
    })
    expect(realtime.emitToUser).toHaveBeenCalledTimes(2)
  })

  it('скрытие «у себя» снимает строки только этого участника', async () => {
    const { service, prisma } = setup()
    prisma.chatAttention.findMany.mockResolvedValue([{ userId: 'me' }])
    await service.onMessagesGone({ chatId: 'c1', messageIds: ['m1'], userId: 'me' })
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', messageId: { in: ['m1'] }, userId: 'me' },
    })
  })

  it('«Прочитать» чаты целиком обнуляет счётчики там, где они были', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatAttention.groupBy.mockResolvedValueOnce([{ chatId: 'c2', _count: { _all: 3 } }])
    await service.onChatsRead({ userId: 'me', chatIds: ['c1', 'c2'] })
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'me', chatId: { in: ['c2'] } },
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('me', CHAT_ATTENTION_EVENT, {
      chatId: 'c2',
      unreadMentionsCount: 0,
      unreadReactionsCount: 0,
    })
  })

  it('очистка истории снимает строки невидимых теперь сообщений', async () => {
    const { service, prisma, chats } = setup()
    prisma.chatAttention.deleteMany.mockResolvedValue({ count: 1 })
    await service.onHistoryCleared({ chatId: 'c1', userId: 'me' })
    expect(chats.visibleMessagesWhere).toHaveBeenCalledWith('me', 'c1')
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'me',
        chatId: 'c1',
        NOT: { message: { chatId: 'c1', deletedAt: null, hiddenBy: { none: { userId: 'me' } } } },
      },
    })
  })

  it('countsFor раскладывает GROUP BY по чатам и видам', async () => {
    const { service, prisma } = setup()
    prisma.chatAttention.groupBy.mockResolvedValue([
      { chatId: 'c1', kind: ChatAttentionKind.MENTION, _count: { _all: 2 } },
      { chatId: 'c1', kind: ChatAttentionKind.REACTION, _count: { _all: 1 } },
      { chatId: 'c2', kind: ChatAttentionKind.REACTION, _count: { _all: 4 } },
    ])
    const out = await service.countsFor('me', [
      { chatId: 'c1', messageWhere: {} },
      { chatId: 'c2', messageWhere: { createdAt: { gt: new Date(0) } } },
    ])
    expect(out.get('c1')).toEqual({ unreadMentionsCount: 2, unreadReactionsCount: 1 })
    expect(out.get('c2')).toEqual({ unreadMentionsCount: 0, unreadReactionsCount: 4 })
    const where = prisma.chatAttention.groupBy.mock.calls[0]?.[0]?.where as {
      userId: string
      message: unknown
    }
    expect(where.userId).toBe('me')
    // Удалённые и скрытые «у себя» не считаются, даже если строки ещё не убраны.
    expect(where.message).toEqual({ deletedAt: null, hiddenBy: { none: { userId: 'me' } } })
    await expect(service.countsFor('me', [])).resolves.toEqual(new Map())
  })

  it('выдача непрочитанных — по видимости смотрящего, старые первыми', async () => {
    const { service, prisma, chats } = setup()
    const at = new Date('2026-11-17T10:00:00Z')
    prisma.chatAttention.findMany.mockResolvedValue([
      { messageId: 'm1', message: { seq: 5, createdAt: at } },
    ])
    prisma.chatAttention.count.mockResolvedValue(1)
    const res = await service.listUnread('me', 'c1', ChatAttentionKind.MENTION)
    expect(chats.visibleMessagesWhere).toHaveBeenCalledWith('me', 'c1')
    expect(res).toEqual({ items: [{ messageId: 'm1', seq: 5, createdAt: at }], count: 1 })
    const q = prisma.chatAttention.findMany.mock.calls[0]?.[0] as {
      orderBy: unknown
      take: number
    }
    expect(q.orderBy).toEqual({ message: { seq: 'asc' } })
    expect(q.take).toBeGreaterThan(0)
  })

  it('прочтение по одному и всех: только своё, событие — если что-то снялось', async () => {
    const { service, prisma, realtime, chats } = setup()
    prisma.chatAttention.deleteMany.mockResolvedValueOnce({ count: 1 })
    const counts = await service.markRead('me', 'c1', ChatAttentionKind.MENTION, ['m1'])
    expect(chats.assertMembership).toHaveBeenCalledWith('me', 'c1')
    expect(prisma.chatAttention.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'me',
        chatId: 'c1',
        kind: ChatAttentionKind.MENTION,
        messageId: { in: ['m1'] },
      },
    })
    expect(counts).toEqual({ unreadMentionsCount: 0, unreadReactionsCount: 0 })
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1)

    prisma.chatAttention.deleteMany.mockResolvedValueOnce({ count: 0 })
    await service.markRead('me', 'c1', ChatAttentionKind.REACTION)
    expect(prisma.chatAttention.deleteMany).toHaveBeenLastCalledWith({
      where: { userId: 'me', chatId: 'c1', kind: ChatAttentionKind.REACTION },
    })
    // Снимать было нечего — другим устройствам сообщать не о чем.
    expect(realtime.emitToUser).toHaveBeenCalledTimes(1)
  })

  it('не участник — прочитать нельзя (ошибка членства пробрасывается)', async () => {
    const { service, prisma, chats } = setup()
    chats.assertMembership.mockRejectedValue(new Error('WRONG_SCOPE'))
    await expect(service.markRead('x', 'c1', ChatAttentionKind.MENTION)).rejects.toThrow(
      'WRONG_SCOPE',
    )
    expect(prisma.chatAttention.deleteMany).not.toHaveBeenCalled()
  })
})
