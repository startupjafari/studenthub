import { Role } from '@studenthub/shared-types'
import { MessageReactionSchema, isSingleEmoji } from '@studenthub/shared-schemas'
import { ChatsService } from './chats.service'
import { ChatChecklistsService } from './chat-checklists.service'
import { ChatStickersService } from './chat-stickers.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Функции Telegram-уровня (эпик iOS-чатов): реакции любым эмодзи, пересылка пачкой с
// идемпотентностью, повтор отправки по nonce, «удалить у себя» и пачкой у всех, закрытие
// опроса, чек-листы, стикеры, вкладки общих материалов.

function setup() {
  const prisma = {
    chatMember: {
      // По умолчанию — действующий участник любого чата.
      findUnique: jest.fn().mockResolvedValue({ id: 'mem', bannedAt: null, isAdmin: false }),
      findFirst: jest.fn().mockResolvedValue({ lastReadAt: null }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    messageReaction: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    hiddenMessage: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    file: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      updateMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) =>
          Promise.resolve({ count: where.id?.in?.length ?? 0 }),
        ),
    },
    chat: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ type: 'GROUP', members: [], requestPendingForId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    chatPoll: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    chatPollVote: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([{ last_seq: 1 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma))
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    usersInRoom: jest.fn().mockResolvedValue(new Set<string>()),
  }
  const files = {
    copyToMessage: jest.fn().mockResolvedValue({ id: 'copy-1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    getPresignedUrls: jest.fn().mockResolvedValue(new Map()),
  }
  const posts = { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) }
  // Минимальный Redis: SET с NX и GET поверх карты — хватает для nonce и идемпотентности.
  const store = new Map<string, string>()
  const redis = {
    store,
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    del: jest.fn((key: string) => Promise.resolve(store.delete(key) ? 1 : 0)),
    set: jest.fn((key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return Promise.resolve(null)
      store.set(key, value)
      return Promise.resolve('OK')
    }),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as never,
    realtime as unknown as RealtimeGateway,
    files as never,
    posts as never,
    {} as never,
    { get: jest.fn().mockReturnValue('chat-media') } as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, prisma, realtime, files, posts, redis, queue }
}

const viewer = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

/** Строка сообщения в форме MESSAGE_SELECT — ровно то, что читают проверки. */
function row(id: string, chatId = 'c1', extra: Record<string, unknown> = {}) {
  return {
    id,
    chatId,
    seq: 1,
    senderId: 'u1',
    content: '',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    silent: false,
    checklist: null,
    ...extra,
  }
}

describe('Реакции: любой один эмодзи', () => {
  it.each(['👍', '❤️', '👍🏽', '👨‍👩‍👧‍👦', '🏳️‍🌈', '🇰🇿', '1️⃣', '🫠'])('принимает %s', (emoji) => {
    expect(isSingleEmoji(emoji)).toBe(true)
    expect(MessageReactionSchema.safeParse({ emoji }).success).toBe(true)
  })

  it.each(['ok', '👍👍', 'ДА', '', '👍 ', 'a👍'])('отклоняет «%s»', (emoji) => {
    expect(MessageReactionSchema.safeParse({ emoji }).success).toBe(false)
  })

  it('сервис ставит эмодзи вне быстрого набора', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue(row('m1'))
    await service.toggleReaction('u1', 'm1', '🦄')
    expect(prisma.messageReaction.create).toHaveBeenCalledWith({
      data: { messageId: 'm1', userId: 'u1', emoji: '🦄' },
    })
  })
})

describe('Повтор отправки по nonce', () => {
  it('первая отправка создаёт сообщение и запоминает его id', async () => {
    const { service, prisma, redis } = setup()
    prisma.message.create.mockResolvedValue(row('m1'))
    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi', nonce: 'n1' })
    expect(res.duplicate).toBe(false)
    expect(prisma.message.create).toHaveBeenCalledTimes(1)
    expect(redis.store.get('chat:nonce:u1:n1')).toBe('m1')
  })

  it('повтор того же nonce отдаёт прежнее сообщение и второе не создаёт', async () => {
    const { service, prisma, redis } = setup()
    redis.store.set('chat:nonce:u1:n1', 'm1')
    prisma.message.findFirst.mockResolvedValue(row('m1'))
    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi', nonce: 'n1' })
    expect(res).toEqual(expect.objectContaining({ duplicate: true }))
    expect(res.message.id).toBe('m1')
    expect(prisma.message.create).not.toHaveBeenCalled()
    // Антифлуд повтор не считает: сообщения не прибавилось.
    expect(redis.incr).not.toHaveBeenCalled()
  })

  it('повтор, пока первая отправка ещё идёт, — REQUEST_IN_PROGRESS', async () => {
    const { service, redis } = setup()
    redis.store.set('chat:nonce:u1:n1', 'pending')
    const err = await service
      .createMessage('u1', { chatId: 'c1', content: 'hi', nonce: 'n1' })
      .catch((e: { code?: string }) => e)
    expect(err.code).toBe('REQUEST_IN_PROGRESS')
  })

  it('сбой отправки снимает ключ — повтор отправит заново', async () => {
    const { service, prisma, redis } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    await expect(
      service.createMessage('u1', { chatId: 'c1', content: 'hi', nonce: 'n1' }),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(redis.store.has('chat:nonce:u1:n1')).toBe(false)
  })

  it('REST-отправка с nonce эхом кладёт nonce в message:new', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.create.mockResolvedValue({ id: 'm1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue(row('m1'))
    await service.sendMessageRest('u1', { chatId: 'c1', content: 'hi', nonce: 'n2' }, [])
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', {
      message: expect.objectContaining({ id: 'm1' }),
      chatId: 'c1',
      nonce: 'n2',
    })
  })
})

describe('Пересылка пачкой', () => {
  function withSources(ctx: ReturnType<typeof setup>) {
    // Выделение пришло не по порядку: s2 новее s1.
    ctx.prisma.message.findMany.mockResolvedValue([
      {
        id: 's2',
        chatId: 'c0',
        seq: 2,
        createdAt: new Date('2026-11-01T10:02:00Z'),
        content: 'второе',
        linkPreview: null,
        sharedPostId: null,
        stickerId: null,
        poll: null,
        location: null,
        contact: null,
        checklist: null,
        media: [],
      },
      {
        id: 's1',
        chatId: 'c0',
        seq: 1,
        createdAt: new Date('2026-11-01T10:01:00Z'),
        content: 'первое',
        linkPreview: null,
        sharedPostId: null,
        stickerId: null,
        poll: null,
        location: { lat: 43.2, lng: 76.9, title: 'КазНУ', address: null },
        contact: null,
        checklist: null,
        media: [],
      },
    ])
    let n = 0
    ctx.prisma.message.create.mockImplementation(() => {
      n += 1
      return Promise.resolve(row(`new-${n}`))
    })
    ctx.prisma.message.findUniqueOrThrow.mockImplementation(
      ({ where }: { where: { id: string } }) => Promise.resolve(row(where.id)),
    )
  }

  const input = {
    messageIds: ['s2', 's1'],
    chatIds: ['c1', 'c2'],
    comment: 'смотри',
    requestId: '11111111-1111-4111-8111-111111111111',
  }

  it('в каждый чат: комментарий, затем пересланные в хронологическом порядке', async () => {
    const ctx = setup()
    withSources(ctx)
    const res = await ctx.service.forwardBatch(viewer('u1'), input)
    expect(res.results).toEqual([
      { chatId: 'c1', ok: true, messageIds: ['new-1', 'new-2', 'new-3'] },
      { chatId: 'c2', ok: true, messageIds: ['new-4', 'new-5', 'new-6'] },
    ])
    const created = ctx.prisma.message.create.mock.calls.map(
      (c: [{ data: { content: string; forwardedFromId?: string } }]) => c[0].data,
    )
    expect(created[0]).toEqual(expect.objectContaining({ content: 'смотри' }))
    expect(created[1]).toEqual(expect.objectContaining({ forwardedFromId: 's1' }))
    expect(created[2]).toEqual(expect.objectContaining({ forwardedFromId: 's2' }))
    // Геопозиция переносится новой записью.
    expect(created[1]).toEqual(
      expect.objectContaining({
        location: { create: { lat: 43.2, lng: 76.9, title: 'КазНУ', address: null } },
      }),
    )
    // Антифлуд — один шаг на всю пачку, а не на каждое из шести сообщений.
    expect(ctx.redis.incr).toHaveBeenCalledTimes(1)
  })

  it('отказ одного чата не роняет другие', async () => {
    const ctx = setup()
    withSources(ctx)
    ctx.prisma.chatMember.findUnique.mockImplementation(
      ({ where }: { where: { chatId_userId: { chatId: string } } }) =>
        Promise.resolve(where.chatId_userId.chatId === 'c1' ? null : { id: 'mem', bannedAt: null }),
    )
    const res = await ctx.service.forwardBatch(viewer('u1'), input)
    expect(res.results[0]).toEqual({ chatId: 'c1', ok: false, messageIds: [], code: 'WRONG_SCOPE' })
    expect(res.results[1]).toEqual(expect.objectContaining({ chatId: 'c2', ok: true }))
  })

  it('повтор с тем же requestId отдаёт сохранённый ответ и ничего не шлёт', async () => {
    const ctx = setup()
    withSources(ctx)
    const first = await ctx.service.forwardBatch(viewer('u1'), input)
    ctx.prisma.message.create.mockClear()
    ctx.realtime.emitToRoom.mockClear()
    const second = await ctx.service.forwardBatch(viewer('u1'), input)
    expect(second).toEqual(first)
    expect(ctx.prisma.message.create).not.toHaveBeenCalled()
    expect(ctx.realtime.emitToRoom).not.toHaveBeenCalled()
    expect(ctx.redis.set).toHaveBeenCalledWith(
      `chat:fwd:u1:${input.requestId}`,
      JSON.stringify(first),
      'EX',
      86400,
    )
  })

  it('тот же requestId, пока первый идёт, — REQUEST_IN_PROGRESS', async () => {
    const ctx = setup()
    ctx.redis.store.set(`chat:fwd:u1:${input.requestId}`, 'pending')
    const err = await ctx.service
      .forwardBatch(viewer('u1'), input)
      .catch((e: { code?: string }) => e)
    expect(err.code).toBe('REQUEST_IN_PROGRESS')
  })

  it('источник не найден — NOT_FOUND, ключ снят для повтора', async () => {
    const ctx = setup()
    ctx.prisma.message.findMany.mockResolvedValue([])
    const err = await ctx.service
      .forwardBatch(viewer('u1'), input)
      .catch((e: { code?: string }) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(ctx.redis.store.has(`chat:fwd:u1:${input.requestId}`)).toBe(false)
  })

  it('потолок непринятого запроса сверяется со всей пачкой', async () => {
    const ctx = setup()
    withSources(ctx)
    ctx.prisma.chat.findUnique.mockResolvedValue({
      type: 'PRIVATE',
      requestPendingForId: 'u2',
      members: [{ userId: 'u2' }],
    })
    // Уже отправлено 3 — ещё 3 (комментарий + 2) превысят потолок 5.
    ctx.prisma.message.count.mockResolvedValue(3)
    const res = await ctx.service.forwardBatch(viewer('u1'), { ...input, chatIds: ['c1'] })
    expect(res.results[0]).toEqual({ chatId: 'c1', ok: false, messageIds: [], code: 'FORBIDDEN' })
  })
})

describe('Удалить у себя и пачкой у всех', () => {
  it('hideMessages скрывает только сообщения этого чата и сообщает своим устройствам', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findMany.mockResolvedValue([{ id: 'm1' }])
    const res = await service.hideMessages('u1', 'c1', ['m1', 'foreign'])
    expect(res).toEqual({ hiddenIds: ['m1'] })
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['m1', 'foreign'] }, chatId: 'c1', deletedAt: null },
      }),
    )
    expect(prisma.hiddenMessage.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', messageId: 'm1' }],
      skipDuplicates: true,
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'message:hidden', {
      chatId: 'c1',
      messageIds: ['m1'],
    })
  })

  it('hideMessages не участнику — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    await expect(service.hideMessages('u1', 'c1', ['m1'])).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })

  it('история не отдаёт скрытое мной', async () => {
    const { service, prisma } = setup()
    await service.getMessages(viewer('u1'), 'c1', { limit: 20 })
    expect(prisma.message.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ hiddenBy: { none: { userId: 'u1' } } }),
    )
  })

  it('deleteMessages удаляет только свои, остальные — в skippedIds', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findMany.mockResolvedValue([{ id: 'mine', seq: 4 }])
    const res = await service.deleteMessages('u1', 'c1', ['mine', 'theirs'])
    expect(res).toEqual({ deletedIds: ['mine'], skippedIds: ['theirs'] })
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['mine', 'theirs'] }, chatId: 'c1', senderId: 'u1', deletedAt: null },
      }),
    )
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:deleted', {
      messageId: 'mine',
      chatId: 'c1',
    })
  })

  it('deleteMessages забаненным — FORBIDDEN, ничего не удаляет', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem', bannedAt: new Date() })
    await expect(service.deleteMessages('u1', 'c1', ['mine'])).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prisma.message.updateMany).not.toHaveBeenCalled()
  })
})

describe('Закрытие опроса', () => {
  function poll(ctx: ReturnType<typeof setup>, senderId: string, closed = false) {
    ctx.prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      closed,
      question: 'Q',
      description: null,
      anonymous: true,
      multiple: false,
      allowRevote: true,
      message: { chatId: 'c1', senderId, deletedAt: null },
      options: [],
    })
  }

  it('автор закрывает и рассылает poll:updated', async () => {
    const ctx = setup()
    poll(ctx, 'u1')
    await ctx.service.closePoll(viewer('u1'), 'p1')
    expect(ctx.prisma.chatPoll.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { closed: true },
    })
    expect(ctx.realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'poll:updated', {
      pollId: 'p1',
      chatId: 'c1',
    })
  })

  it('чужой опрос не админу — FORBIDDEN', async () => {
    const ctx = setup()
    poll(ctx, 'author')
    ctx.prisma.chat.findUnique.mockResolvedValue({ createdById: 'owner' })
    await expect(ctx.service.closePoll(viewer('u1'), 'p1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(ctx.prisma.chatPoll.update).not.toHaveBeenCalled()
  })

  it('админ группы закрывает чужой опрос', async () => {
    const ctx = setup()
    poll(ctx, 'author')
    ctx.prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem', bannedAt: null, isAdmin: true })
    await ctx.service.closePoll(viewer('u1'), 'p1')
    expect(ctx.prisma.chatPoll.update).toHaveBeenCalled()
  })

  it('владелец группы закрывает чужой опрос', async () => {
    const ctx = setup()
    poll(ctx, 'author')
    ctx.prisma.chat.findUnique.mockResolvedValue({ createdById: 'u1' })
    await ctx.service.closePoll(viewer('u1'), 'p1')
    expect(ctx.prisma.chatPoll.update).toHaveBeenCalled()
  })

  it('уже закрытый — без записи и без события', async () => {
    const ctx = setup()
    poll(ctx, 'u1', true)
    await ctx.service.closePoll(viewer('u1'), 'p1')
    expect(ctx.prisma.chatPoll.update).not.toHaveBeenCalled()
    expect(ctx.realtime.emitToRoom).not.toHaveBeenCalled()
  })

  it('голос в закрытом опросе — POLL_CLOSED', async () => {
    const ctx = setup()
    poll(ctx, 'u1', true)
    await expect(ctx.service.votePoll(viewer('u1'), 'p1', { optionIds: [] })).rejects.toMatchObject(
      { code: 'POLL_CLOSED' },
    )
  })
})

describe('Вкладки общих материалов', () => {
  async function whereFor(type: 'music' | 'voice_note' | 'gif' | 'voice') {
    const { service, prisma } = setup()
    await service.listChatMedia(viewer('u1'), 'c1', { type, limit: 20 })
    return prisma.file.findMany.mock.calls[0][0].where
  }

  it('music — аудио кроме голосовых', async () => {
    expect(await whereFor('music')).toEqual(
      expect.objectContaining({
        mime: { startsWith: 'audio/' },
        OR: [{ name: null }, { NOT: { name: { startsWith: 'voice-' } } }],
      }),
    )
  })

  it('voice_note — только голосовые', async () => {
    expect(await whereFor('voice_note')).toEqual(
      expect.objectContaining({ mime: { startsWith: 'audio/' }, name: { startsWith: 'voice-' } }),
    )
  })

  it('gif — только image/gif', async () => {
    expect(await whereFor('gif')).toEqual(expect.objectContaining({ mime: 'image/gif' }))
  })

  it('voice — по-прежнему всё аудио (веб)', async () => {
    const where = await whereFor('voice')
    expect(where).toEqual(expect.objectContaining({ mime: { startsWith: 'audio/' } }))
    expect(where.name).toBeUndefined()
  })
})

describe('GIF: повторная отправка', () => {
  it('файл не GIF — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.file.findUnique.mockResolvedValue({
      id: 'f1',
      mime: 'image/png',
      message: { chatId: 'c0', deletedAt: null },
    })
    await expect(service.sendGif('u1', 'c1', { fileId: 'f1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('GIF из чата, где я не участник, — WRONG_SCOPE, копия не делается', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue({
      id: 'f1',
      mime: 'image/gif',
      message: { chatId: 'c0', deletedAt: null },
    })
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    await expect(service.sendGif('u1', 'c1', { fileId: 'f1' })).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(files.copyToMessage).not.toHaveBeenCalled()
  })

  it('копия GIF привязывается к новому сообщению с пустым текстом', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findUnique.mockResolvedValue({
      id: 'f1',
      bucket: 'chat-media',
      key: 'k.gif',
      mime: 'image/gif',
      size: 10,
      name: null,
      width: 1,
      height: 1,
      message: { chatId: 'c0', deletedAt: null },
    })
    prisma.message.create.mockResolvedValue({ id: 'm1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue(row('m1'))
    await service.sendGif('u1', 'c1', { fileId: 'f1' })
    expect(files.copyToMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }), 'u1')
    expect(prisma.message.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ chatId: 'c1', content: '' }),
    )
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['copy-1'] }, messageId: null },
      data: { messageId: 'm1' },
    })
  })
})

describe('Чек-листы', () => {
  function checklistSetup(opts: { othersCanAdd?: boolean; othersCanMark?: boolean } = {}) {
    const prisma = {
      chatChecklist: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cl1',
          othersCanAdd: opts.othersCanAdd ?? true,
          othersCanMark: opts.othersCanMark ?? true,
          message: { chatId: 'c1', senderId: 'author', deletedAt: null },
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'cl1',
          title: 'T',
          othersCanAdd: true,
          othersCanMark: true,
          items: [{ id: 'i1', text: 'a', order: 0, doneAt: null, doneBy: null }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      chatChecklistItem: {
        findFirst: jest.fn().mockResolvedValue({ order: 0, createdById: 'helper' }),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn().mockResolvedValue(1),
    }
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : arg,
    )
    const chats = { assertMembership: jest.fn(), assertCanAct: jest.fn() }
    const realtime = { emitToRoom: jest.fn() }
    const service = new ChatChecklistsService(
      prisma as unknown as PrismaService,
      chats as unknown as ChatsService,
      realtime as unknown as RealtimeGateway,
    )
    return { service, prisma, chats, realtime }
  }

  it('участник добавляет пункт при othersCanAdd и все получают checklist:updated', async () => {
    const { service, prisma, realtime } = checklistSetup()
    const res = await service.addItem('member', 'cl1', 'b')
    expect(prisma.chatChecklistItem.create).toHaveBeenCalledWith({
      data: { checklistId: 'cl1', text: 'b', order: 1, createdById: 'member' },
    })
    expect(res.items[0]).toEqual(expect.objectContaining({ id: 'i1', done: false }))
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'checklist:updated', {
      checklistId: 'cl1',
      chatId: 'c1',
      checklist: res,
    })
  })

  it('без othersCanAdd добавляет только автор', async () => {
    const { service, prisma } = checklistSetup({ othersCanAdd: false })
    await expect(service.addItem('member', 'cl1', 'b')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await service.addItem('author', 'cl1', 'b')
    expect(prisma.chatChecklistItem.create).toHaveBeenCalledTimes(1)
  })

  it('больше 50 пунктов не добавить', async () => {
    const { service, prisma } = checklistSetup()
    prisma.chatChecklistItem.count.mockResolvedValue(50)
    await expect(service.addItem('author', 'cl1', 'b')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('без othersCanMark отмечает только автор', async () => {
    const { service, prisma } = checklistSetup({ othersCanMark: false })
    await expect(service.toggleItem('member', 'cl1', 'i1', true)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await service.toggleItem('author', 'cl1', 'i1', true)
    expect(prisma.chatChecklistItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', checklistId: 'cl1' },
      data: { doneById: 'author', doneAt: expect.any(Date) },
    })
  })

  it('убрать пункт может автор списка или тот, кто его добавил', async () => {
    const { service, prisma } = checklistSetup()
    await expect(service.removeItem('stranger', 'cl1', 'i1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await service.removeItem('helper', 'cl1', 'i1')
    await service.removeItem('author', 'cl1', 'i1')
    expect(prisma.chatChecklistItem.deleteMany).toHaveBeenCalledTimes(2)
  })

  it('не участник чата — отказ проверки членства, без записи', async () => {
    const { service, prisma, chats } = checklistSetup()
    chats.assertCanAct.mockRejectedValue(Object.assign(new Error('no'), { code: 'WRONG_SCOPE' }))
    await expect(service.toggleItem('member', 'cl1', 'i1', true)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.chatChecklistItem.updateMany).not.toHaveBeenCalled()
  })

  it('список удалённого сообщения — NOT_FOUND', async () => {
    const { service, prisma } = checklistSetup()
    prisma.chatChecklist.findUnique.mockResolvedValue({
      id: 'cl1',
      othersCanAdd: true,
      othersCanMark: true,
      message: { chatId: 'c1', senderId: 'author', deletedAt: new Date() },
    })
    await expect(service.get('member', 'cl1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Стикеры', () => {
  function stickerSetup() {
    const prisma = { sticker: { findFirst: jest.fn() } }
    const chats = { sendRichMessage: jest.fn().mockResolvedValue({ id: 'm1' }) }
    const service = new ChatStickersService(
      prisma as unknown as PrismaService,
      {} as never,
      chats as unknown as ChatsService,
      {} as never,
      {} as never,
    )
    return { service, prisma, chats }
  }

  it('стикер опубликованного набора уходит особым сообщением со stickerId', async () => {
    const { service, prisma, chats } = stickerSetup()
    prisma.sticker.findFirst.mockResolvedValue({ id: 'st1' })
    await service.send('u1', 'c1', { stickerId: 'st1', nonce: 'n1' })
    expect(prisma.sticker.findFirst).toHaveBeenCalledWith({
      where: { id: 'st1', set: { isPublished: true } },
      select: { id: true },
    })
    expect(chats.sendRichMessage).toHaveBeenCalledWith('u1', 'c1', {
      replyToId: undefined,
      nonce: 'n1',
      data: { stickerId: 'st1' },
    })
  })

  it('неопубликованный или чужой стикер — NOT_FOUND', async () => {
    const { service, prisma, chats } = stickerSetup()
    prisma.sticker.findFirst.mockResolvedValue(null)
    await expect(service.send('u1', 'c1', { stickerId: 'st1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(chats.sendRichMessage).not.toHaveBeenCalled()
  })
})
