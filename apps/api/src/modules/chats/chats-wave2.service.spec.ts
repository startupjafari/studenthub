import { Role } from '@studenthub/shared-types'
import {
  CreateChatFolderSchema,
  FAVORITE_STICKERS_MAX,
  UpdateChatFolderSchema,
  chatInFolder,
  type ChatFolderRule,
} from '@studenthub/shared-schemas'
import { ChatsService, type MessageRow } from './chats.service'
import { ChatFoldersService } from './chat-folders.service'
import { ChatStickersService } from './chat-stickers.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

// Чаты как Telegram, волна 2 (контракт iOS): «пометить как новое», порядок закреплённых,
// прочтение пачкой, открепить все, отложенные с «отправить сейчас», позиция и направление
// медиа, отмена загрузки вложения, total поиска, папки с правилами, избранные стикеры.

function setup() {
  const prisma = {
    chatMember: {
      // По умолчанию — действующий участник любого чата.
      findUnique: jest.fn().mockResolvedValue({ id: 'mem', bannedAt: null, clearedAt: null }),
      findFirst: jest.fn().mockResolvedValue({ lastReadAt: null }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    scheduledMessage: {
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    file: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    chat: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest
        .fn()
        .mockResolvedValue({ type: 'GROUP', members: [], requestPendingForId: null }),
    },
    friendship: { findMany: jest.fn().mockResolvedValue([]) },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
  // Колбэк — с тем же моком в роли tx; массив — просто дожидаемся всех запросов пачки.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof prisma) => unknown)(prisma),
  )
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    onlineAmong: jest.fn().mockReturnValue([]),
  }
  const files = { abortMultipart: jest.fn().mockResolvedValue(undefined) }
  const redis = {
    set: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as never,
    realtime as unknown as RealtimeGateway,
    files as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockReturnValue('chat-media') } as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, prisma, realtime, files, redis, queue }
}

/** Подмена приватной проверки «можно ли писать» — её правила проверяет основная спека. */
function allowSend(service: ChatsService): jest.SpyInstance {
  return jest
    .spyOn(service as unknown as { assertCanSend: () => Promise<void> }, 'assertCanSend')
    .mockResolvedValue(undefined)
}

const viewer = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

function eventsTo(realtime: { emitToUser: jest.Mock }, event: string): unknown[] {
  return realtime.emitToUser.mock.calls.filter((c) => c[1] === event).map((c) => c[2])
}

describe('«Пометить как новое»', () => {
  it('POST ставит отметку, DELETE снимает; своим устройствам — chat:list-changed', async () => {
    const { service, prisma, realtime } = setup()
    await service.setChatMarkedUnread('u1', 'c1', true)
    expect(prisma.chatMember.updateMany).toHaveBeenLastCalledWith({
      where: { chatId: 'c1', userId: 'u1' },
      data: { markedUnreadAt: expect.any(Date) },
    })
    await service.setChatMarkedUnread('u1', 'c1', false)
    expect(prisma.chatMember.updateMany).toHaveBeenLastCalledWith({
      where: { chatId: 'c1', userId: 'u1' },
      data: { markedUnreadAt: null },
    })
    expect(eventsTo(realtime, 'chat:list-changed')).toEqual([
      { chatIds: ['c1'] },
      { chatIds: ['c1'] },
    ])
  })

  it('не участник — WRONG_SCOPE, отметка не ставится', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    await expect(service.setChatMarkedUnread('u1', 'c1', true)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })

  it('прочтение по WS (markRead) снимает отметку до сигнала chat:read', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findFirst.mockResolvedValue({ createdAt: new Date('2026-11-14T10:00:00Z') })
    await service.markRead('u1', 'c1', 'm1')
    const clear = prisma.chatMember.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { markedUnreadAt?: unknown } }).data.markedUnreadAt === null,
    )
    expect(clear?.[0]).toEqual({
      where: { chatId: 'c1', userId: 'u1', markedUnreadAt: { not: null } },
      data: { markedUnreadAt: null },
    })
    const clearOrder = prisma.chatMember.updateMany.mock.invocationCallOrder[0]!
    const readOrder = realtime.emitToUser.mock.invocationCallOrder[0]!
    expect(clearOrder).toBeLessThan(readOrder)
    expect(eventsTo(realtime, 'chat:read')).toHaveLength(1)
  })

  it('сводка: помеченный чат без непрочитанных — +1 чат и +1 сообщение (заглушённый — в muted)', async () => {
    const { service, prisma } = setup()
    const base = {
      lastReadAt: null,
      mutedAt: null,
      mutedUntil: null,
      clearedAt: null,
      clearedRanges: null,
      chat: { requestPendingForId: null },
    }
    prisma.chatMember.findMany.mockResolvedValue([
      { ...base, chatId: 'marked', markedUnreadAt: new Date() },
      { ...base, chatId: 'marked-muted', markedUnreadAt: new Date(), mutedAt: new Date() },
      // Помечен, но и так с непрочитанными — лишней единицы нет.
      { ...base, chatId: 'both', markedUnreadAt: new Date() },
      { ...base, chatId: 'plain', markedUnreadAt: null },
    ])
    prisma.message.groupBy.mockResolvedValue([
      { chatId: 'both', _count: { _all: 3 } },
      { chatId: 'plain', _count: { _all: 2 } },
    ])
    await expect(service.getUnreadSummary(viewer('u1'))).resolves.toEqual({
      chats: 3,
      messages: 6,
      muted: { chats: 1, messages: 1 },
    })
  })
})

describe('Прочтение пачкой (POST /chats/read)', () => {
  const t1 = new Date('2026-11-14T09:00:00Z')
  const t2 = new Date('2026-11-14T10:00:00Z')

  it('чужие чаты пропускаются; отметка сдвигается до последнего сообщения, пометка снимается', async () => {
    const { service, prisma, realtime } = setup()
    // Участник только в c1 и c2 из трёх присланных.
    prisma.chatMember.findMany.mockResolvedValue([
      { chatId: 'c1', lastReadAt: t1, markedUnreadAt: null },
      { chatId: 'c2', lastReadAt: t2, markedUnreadAt: new Date() },
    ])
    prisma.$queryRaw.mockResolvedValue([
      { chatId: 'c1', id: 'm1' },
      { chatId: 'c2', id: 'm2' },
    ])
    prisma.message.findMany.mockResolvedValue([
      { id: 'm1', chatId: 'c1', createdAt: t2 },
      // В c2 всё уже прочитано — сдвигать нечего, только снять пометку.
      { id: 'm2', chatId: 'c2', createdAt: t2 },
    ])

    await expect(service.markChatsRead('u1', ['c1', 'c2', 'c-чужой'])).resolves.toEqual({
      updated: 2,
    })

    expect(prisma.chatMember.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      bannedAt: null,
      chatId: { in: ['c1', 'c2', 'c-чужой'] },
    })
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', chatId: { in: ['c1', 'c2'] }, markedUnreadAt: { not: null } },
      data: { markedUnreadAt: null },
    })
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', userId: 'u1', OR: [{ lastReadAt: null }, { lastReadAt: { lt: t2 } }] },
      data: { lastReadAt: t2 },
    })
    // Другим участникам — message:read только там, где отметка сдвинулась.
    expect(realtime.emitToRoom).toHaveBeenCalledTimes(1)
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:read', {
      chatId: 'c1',
      messageId: 'm1',
      userId: 'u1',
      readAt: t2,
    })
    expect(eventsTo(realtime, 'chat:read')).toEqual([{ chatId: 'c1', readAt: t2 }])
    expect(eventsTo(realtime, 'chat:list-changed')).toEqual([{ chatIds: ['c2'] }])
  })

  it('ни одного своего чата — ничего не пишет', async () => {
    const { service, prisma, realtime } = setup()
    await expect(service.markChatsRead('u1', ['c-чужой'])).resolves.toEqual({ updated: 0 })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
    expect(realtime.emitToUser).not.toHaveBeenCalled()
  })
})

describe('Порядок закреплённых чатов', () => {
  it('закрепление ставит чат на 0 и сдвигает остальных', async () => {
    const { service, prisma, realtime } = setup()
    await service.setChatPinned('u1', 'c1', true)
    expect(prisma.chatMember.updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'u1', chatId: { not: 'c1' }, pinnedOrder: { not: null } },
      data: { pinnedOrder: { increment: 1 } },
    })
    expect(prisma.chatMember.updateMany).toHaveBeenNthCalledWith(2, {
      where: { chatId: 'c1', userId: 'u1' },
      data: { pinnedAt: expect.any(Date), pinnedOrder: 0 },
    })
    expect(eventsTo(realtime, 'chat:list-changed')).toEqual([{ chatIds: ['c1'] }])
  })

  it('открепление обнуляет место и никого не сдвигает', async () => {
    const { service, prisma } = setup()
    await service.setChatPinned('u1', 'c1', false)
    expect(prisma.chatMember.updateMany).toHaveBeenCalledTimes(1)
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { chatId: 'c1', userId: 'u1' },
      data: { pinnedAt: null, pinnedOrder: null },
    })
  })

  it('перечисленные — сверху, остальные закреплённые — ниже в прежнем порядке', async () => {
    const { service, prisma, realtime } = setup()
    // Прежний порядок закреплённых (как отдаёт orderBy): a, b, c, d.
    prisma.chatMember.findMany.mockResolvedValue(
      ['a', 'b', 'c', 'd'].map((chatId) => ({ chatId, pinnedOrder: null, pinnedAt: new Date() })),
    )
    await service.setPinnedOrder('u1', ['c', 'a'])
    const writes = prisma.chatMember.updateMany.mock.calls.map((c) => [
      c[0].where.chatId,
      c[0].data.pinnedOrder,
    ])
    expect(writes).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
      ['d', 3],
    ])
    expect(eventsTo(realtime, 'chat:list-changed')).toEqual([{ chatIds: ['c', 'a', 'b', 'd'] }])
  })

  it('незакреплённый чат в порядке — 422, ничего не пишется', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue([
      { chatId: 'a', pinnedOrder: 0, pinnedAt: new Date() },
    ])
    await expect(service.setPinnedOrder('u1', ['a', 'не-закреплён'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })
})

describe('Открепить все сообщения чата', () => {
  it('снимает закреп со всех, message:unpinned по каждому и один chat:pinned участникам', async () => {
    const { service, prisma, realtime } = setup()
    allowSend(service)
    prisma.message.findMany
      .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }])
      .mockResolvedValueOnce([
        { id: 'm1', chatId: 'c1', checklist: null },
        { id: 'm2', chatId: 'c1', checklist: null },
      ])
    // allMembers: участники чата одной пачкой.
    prisma.chatMember.findMany.mockResolvedValueOnce([
      { id: 'x1', userId: 'u1', mutedAt: null, mutedUntil: null, muteImportantOnly: false },
      { id: 'x2', userId: 'u2', mutedAt: null, mutedUntil: null, muteImportantOnly: false },
    ])

    await expect(service.unpinAllMessages('u1', 'c1')).resolves.toEqual({ count: 2 })
    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
      data: { pinnedAt: null, pinnedById: null, unpinnedAt: expect.any(Date) },
    })
    const unpinned = realtime.emitToRoom.mock.calls.filter((c) => c[1] === 'message:unpinned')
    expect(unpinned).toHaveLength(2)
    expect(eventsTo(realtime, 'chat:pinned')).toEqual([{ chatId: 'c1' }, { chatId: 'c1' }])
  })

  it('не участник — WRONG_SCOPE, закрепы не трогаются', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    await expect(service.unpinAllMessages('u1', 'c1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.message.updateMany).not.toHaveBeenCalled()
  })
})

describe('Отложенные сообщения', () => {
  const future = new Date(Date.now() + 3600_000)
  const row = {
    id: 's1',
    chatId: 'c1',
    senderId: 'u1',
    content: 'привет',
    replyToId: null,
    replyQuote: null,
    silent: false,
    scheduledAt: future,
    createdAt: new Date(),
  }

  it('создание: проверка права писать и сигнал своим устройствам', async () => {
    const { service, prisma, realtime } = setup()
    const canSend = allowSend(service)
    prisma.scheduledMessage.create.mockResolvedValue(row)
    await expect(
      service.scheduleMessage('u1', 'c1', { content: 'привет', scheduledAt: future.toISOString() }),
    ).resolves.toEqual(row)
    expect(canSend).toHaveBeenCalledWith('c1', 'u1')
    expect(prisma.scheduledMessage.create.mock.calls[0][0].data).toMatchObject({
      chatId: 'c1',
      senderId: 'u1',
      content: 'привет',
      silent: false,
    })
    expect(eventsTo(realtime, 'chat:scheduled-changed')).toEqual([{ chatId: 'c1' }])
  })

  it('сверх 100 ждущих в чате — BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    allowSend(service)
    prisma.scheduledMessage.count.mockResolvedValue(100)
    await expect(
      service.scheduleMessage('u1', 'c1', { content: 'x', scheduledAt: future.toISOString() }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.scheduledMessage.create).not.toHaveBeenCalled()
  })

  it('список — только свои в чате, по времени, не больше 100', async () => {
    const { service, prisma } = setup()
    await service.listScheduled('u1', 'c1')
    expect(prisma.scheduledMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chatId: 'c1', senderId: 'u1' },
        orderBy: { scheduledAt: 'asc' },
        take: 100,
      }),
    )
  })

  it.each([
    ['правка', (s: ChatsService) => s.updateScheduled('u2', 's1', { content: 'x' })],
    ['отмена', (s: ChatsService) => s.cancelScheduled('u2', 's1')],
    ['отправить сейчас', (s: ChatsService) => s.sendScheduledNow('u2', 's1')],
  ])('%s чужого отложенного — NOT_FOUND', async (_name, act) => {
    const { service, prisma } = setup()
    prisma.scheduledMessage.findUnique.mockResolvedValue(row)
    await expect(act(service)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.scheduledMessage.update).not.toHaveBeenCalled()
    expect(prisma.scheduledMessage.deleteMany).not.toHaveBeenCalled()
  })

  it('правка и отмена своего', async () => {
    const { service, prisma, realtime } = setup()
    prisma.scheduledMessage.findUnique.mockResolvedValue(row)
    prisma.scheduledMessage.update.mockResolvedValue({ ...row, content: 'новое' })
    await expect(service.updateScheduled('u1', 's1', { content: 'новое' })).resolves.toMatchObject({
      content: 'новое',
    })
    await service.cancelScheduled('u1', 's1')
    expect(prisma.scheduledMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: 's1', senderId: 'u1' },
    })
    expect(eventsTo(realtime, 'chat:scheduled-changed')).toHaveLength(2)
  })

  it('отправить сейчас — тем же путём, что cron: createMessage и message:new в чат', async () => {
    const { service, prisma, realtime } = setup()
    prisma.scheduledMessage.findUnique.mockResolvedValue(row)
    const message = { id: 'm9', chatId: 'c1' } as MessageRow
    const create = jest
      .spyOn(service, 'createMessage')
      .mockResolvedValue({ message, recipientIds: [], duplicate: false })

    await expect(service.sendScheduledNow('u1', 's1')).resolves.toBe(message)
    // Человек нажал кнопку — антифлуд действует (cron его пропускает).
    expect(create).toHaveBeenCalledWith(
      'u1',
      { chatId: 'c1', content: 'привет', silent: false },
      {},
    )
    expect(prisma.scheduledMessage.deleteMany).toHaveBeenCalledWith({
      where: { id: 's1', senderId: 'u1' },
    })
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', {
      message,
      chatId: 'c1',
    })
  })

  it('отправить сейчас: отказ отправки возвращает отложенное на место', async () => {
    const { service, prisma } = setup()
    prisma.scheduledMessage.findUnique.mockResolvedValue(row)
    jest
      .spyOn(service, 'createMessage')
      .mockRejectedValue(new AppException('FORBIDDEN', 'Вы заблокированы'))
    await expect(service.sendScheduledNow('u1', 's1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prisma.scheduledMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 's1', chatId: 'c1', content: 'привет' }),
    })
  })

  it('отправить сейчас: строку уже забрал cron — NOT_FOUND, второй отправки нет', async () => {
    const { service, prisma } = setup()
    prisma.scheduledMessage.findUnique.mockResolvedValue(row)
    prisma.scheduledMessage.deleteMany.mockResolvedValue({ count: 0 })
    const create = jest.spyOn(service, 'createMessage')
    await expect(service.sendScheduledNow('u1', 's1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('Медиа: позиция и направление', () => {
  it('позиция считается от самого старого: index = total − новее', async () => {
    const { service, prisma } = setup()
    const at = new Date('2026-11-01T10:00:00Z')
    prisma.file.findFirst.mockResolvedValue({ id: 'f5', createdAt: at })
    prisma.file.count.mockResolvedValueOnce(120).mockResolvedValueOnce(115)

    await expect(service.getChatMediaPosition(viewer('u1'), 'c1', 'f5', 'media')).resolves.toEqual({
      index: 5,
      total: 120,
    })
    const newerWhere = prisma.file.count.mock.calls[1][0].where
    expect(newerWhere.AND[1]).toEqual({
      OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: 'f5' } }],
    })
    // Фильтры — как у списка: удалённые и скрытые у себя не считаются.
    expect(newerWhere.AND[0].message).toMatchObject({
      chatId: 'c1',
      deletedAt: null,
      hiddenBy: { none: { userId: 'u1' } },
    })
  })

  it('файла нет в этой вкладке чата — NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.file.findFirst.mockResolvedValue(null)
    await expect(
      service.getChatMediaPosition(viewer('u1'), 'c1', 'f-чужой', 'media'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('direction=newer: от курсора к новым, выдача свежими первыми, prevCursor/hasPrev', async () => {
    const { service, prisma } = setup()
    const file = (id: string) => ({
      id,
      name: null,
      mime: 'image/jpeg',
      size: 1,
      posterKey: null,
      width: null,
      height: null,
      placeholder: null,
      durationMs: null,
      mediaStatus: null,
      createdAt: new Date(),
      messageId: 'm',
      message: null,
    })
    // По возрастанию от курсора: f6, f7, f8 (limit 2 → есть ещё).
    prisma.file.findMany.mockResolvedValue([file('f6'), file('f7'), file('f8')])
    const page = await service.listChatMedia(viewer('u1'), 'c1', {
      type: 'media',
      limit: 2,
      cursor: 'f5',
      direction: 'newer',
    })
    expect(prisma.file.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      cursor: { id: 'f5' },
      skip: 1,
    })
    expect(page.items.map((i) => i.id)).toEqual(['f7', 'f6'])
    expect(page.meta).toEqual({ prevCursor: 'f7', hasPrev: true })
  })
})

describe('Отмена многочастной загрузки вложения', () => {
  it('проверку ключа делает FileService по id вызывающего; бакет — чатовый', async () => {
    const { service, files } = setup()
    await service.abortAttachmentMultipart('u1', { key: 'u1/a.mp4', uploadId: 'up' })
    expect(files.abortMultipart).toHaveBeenCalledWith({
      bucket: 'chat-media',
      ownerId: 'u1',
      key: 'u1/a.mp4',
      uploadId: 'up',
    })
  })

  it('чужой ключ — отказ FileService доходит до клиента', async () => {
    const { service, files } = setup()
    files.abortMultipart.mockRejectedValue(
      new AppException('FORBIDDEN', 'Ключ не принадлежит вызывающему'),
    )
    await expect(
      service.abortAttachmentMultipart('u1', { key: 'u2/a.mp4', uploadId: 'up' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('Поиск по чату: meta.total', () => {
  it('total — по всем совпадениям в чате, без курсора', async () => {
    const { service, prisma } = setup()
    prisma.message.count.mockResolvedValue(57)
    const page = await service.searchMessages(viewer('u1'), { q: 'зачёт', chatId: 'c1', limit: 20 })
    expect(page.meta.total).toBe(57)
    expect(prisma.message.count.mock.calls[0][0].where.seq).toBeUndefined()
  })

  it('поиск по всем чатам — без total', async () => {
    const { service, prisma } = setup()
    const page = await service.searchMessages(viewer('u1'), { q: 'зачёт', limit: 20 })
    expect(page.meta.total).toBeUndefined()
    expect(prisma.message.count).not.toHaveBeenCalled()
  })
})

describe('Список чатов: markedUnread, pinnedOrder, isFriend', () => {
  it('поля строки и дружба одним запросом на страницу', async () => {
    const { service, prisma } = setup()
    // Провижининг официальных чатов уже был недавно — не мешает.
    prisma.chat.findMany.mockResolvedValue([
      {
        id: 'p1',
        type: 'PRIVATE',
        title: null,
        description: null,
        avatarUrl: null,
        createdById: null,
        groupId: null,
        facultyId: null,
        universityId: null,
        subject: null,
        requestPendingForId: null,
        updatedAt: new Date(),
        members: [
          {
            lastReadAt: null,
            mutedAt: null,
            mutedUntil: null,
            muteImportantOnly: false,
            isAdmin: false,
            clearedAt: null,
            clearedRanges: null,
            draft: null,
            pinnedAt: new Date(),
            pinnedOrder: 2,
            markedUnreadAt: new Date(),
            archivedAt: null,
          },
        ],
        _count: { members: 2 },
      },
    ])
    prisma.chatMember.findMany.mockResolvedValue([
      { chatId: 'p1', userId: 'u2', user: { avatarUrl: null, firstName: 'A', lastName: 'B' } },
    ])
    prisma.friendship.findMany.mockResolvedValue([{ requesterId: 'u2', addresseeId: 'u1' }])

    const page = await service.listChats(viewer('u1'), { limit: 50, cursor: 'x_y' })
    expect(page.items[0]).toMatchObject({ markedUnread: true, pinnedOrder: 2, isFriend: true })
    expect(prisma.friendship.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.friendship.findMany.mock.calls[0][0].where.status).toBe('ACCEPTED')
  })
})

// ── Папки ─────────────────────────────────────────────────────────────────────

const rule = (over: Partial<ChatFolderRule> = {}): ChatFolderRule => ({
  chatIds: [],
  excludedChatIds: [],
  includeContacts: false,
  includeNonContacts: false,
  includeGroups: false,
  ...over,
})

describe('Правило состава папки (chatInFolder)', () => {
  it('явный чат входит, исключённый — нет, даже если подходит под правило', () => {
    const f = rule({ chatIds: ['s'], excludedChatIds: ['g'], includeGroups: true })
    expect(chatInFolder(f, { id: 's', type: 'SAVED', isFriend: false })).toBe(true)
    expect(chatInFolder(f, { id: 'g', type: 'GROUP', isFriend: false })).toBe(false)
  })

  it('контакты и не контакты — только личные чаты, по дружбе', () => {
    const contacts = rule({ includeContacts: true })
    const others = rule({ includeNonContacts: true })
    expect(chatInFolder(contacts, { id: 'p', type: 'PRIVATE', isFriend: true })).toBe(true)
    expect(chatInFolder(contacts, { id: 'p', type: 'PRIVATE', isFriend: false })).toBe(false)
    expect(chatInFolder(others, { id: 'p', type: 'PRIVATE', isFriend: false })).toBe(true)
    expect(chatInFolder(others, { id: 'p', type: 'PRIVATE', isFriend: true })).toBe(false)
    expect(chatInFolder(contacts, { id: 'g', type: 'GROUP', isFriend: true })).toBe(false)
  })

  it.each(['GROUP', 'GROUP_OFFICIAL', 'SUBJECT', 'FACULTY', 'DEAN', 'EVENT'])(
    '«все группы» включает %s',
    (type) => {
      expect(chatInFolder(rule({ includeGroups: true }), { id: 'x', type, isFriend: false })).toBe(
        true,
      )
    },
  )

  it.each(['SAVED', 'SUPPORT', 'SUPPORT_PLATFORM', 'PRIVATE'])(
    '%s правилами не попадает — только явно',
    (type) => {
      const all = rule({ includeContacts: false, includeNonContacts: false, includeGroups: true })
      expect(chatInFolder(all, { id: 'x', type, isFriend: false })).toBe(false)
    },
  )

  it('схема: чат и в составе, и в исключениях — ошибка', () => {
    const res = CreateChatFolderSchema.safeParse({
      name: 'Учёба',
      chatIds: ['c1'],
      excludedChatIds: ['c1'],
    })
    expect(res.success).toBe(false)
    expect(res.error?.issues[0]?.message).toBe('validation.chats.folderChatExcluded')
    expect(UpdateChatFolderSchema.safeParse({ emoji: '📚', color: 6 }).success).toBe(true)
    expect(UpdateChatFolderSchema.safeParse({ emoji: 'ab' }).success).toBe(false)
    expect(UpdateChatFolderSchema.safeParse({ color: 7 }).success).toBe(false)
  })
})

function foldersSetup() {
  const models = {
    chatFolder: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    chatFolderItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    chatMember: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    friendship: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const prisma = {
    ...models,
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof models) => unknown)(models),
    ),
  }
  const realtime = { emitToUser: jest.fn() }
  const service = new ChatFoldersService(prisma as never, realtime as never)
  return { service, prisma, realtime }
}

describe('Папки: порядок, заглушение, исключения', () => {
  it('порядок — ровно множество моих папок; позиции 0..n-1 и chat:folders-changed', async () => {
    const { service, prisma, realtime } = foldersSetup()
    prisma.chatFolder.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    await service.reorder('u1', ['c', 'a', 'b'])
    expect(prisma.chatFolder.updateMany.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 'c', userId: 'u1' }, data: { position: 0 } },
      { where: { id: 'a', userId: 'u1' }, data: { position: 1 } },
      { where: { id: 'b', userId: 'u1' }, data: { position: 2 } },
    ])
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:folders-changed', {})
  })

  it.each([
    ['неполное множество', ['a', 'b']],
    ['чужая папка', ['a', 'b', 'чужая']],
  ])('порядок: %s — 422', async (_name, ids) => {
    const { service, prisma } = foldersSetup()
    prisma.chatFolder.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    await expect(service.reorder('u1', ids)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(prisma.chatFolder.updateMany).not.toHaveBeenCalled()
  })

  it('заглушение папки — по правилу состава: явные, группы и контакты минус исключения', async () => {
    const { service, prisma, realtime } = foldersSetup()
    prisma.chatFolder.findFirst.mockResolvedValue({
      includeContacts: true,
      includeNonContacts: false,
      includeGroups: true,
      items: [
        { chatId: 'saved', excluded: false },
        { chatId: 'g-excl', excluded: true },
      ],
    })
    prisma.chatMember.findMany
      // Мои чаты (с правилами — весь список).
      .mockResolvedValueOnce([
        { chatId: 'saved', chat: { type: 'SAVED' } },
        { chatId: 'support', chat: { type: 'SUPPORT' } },
        { chatId: 'g1', chat: { type: 'GROUP' } },
        { chatId: 'g-excl', chat: { type: 'FACULTY' } },
        { chatId: 'p-friend', chat: { type: 'PRIVATE' } },
        { chatId: 'p-other', chat: { type: 'PRIVATE' } },
      ])
      // Собеседники личных чатов.
      .mockResolvedValueOnce([
        { chatId: 'p-friend', userId: 'u2' },
        { chatId: 'p-other', userId: 'u3' },
      ])
    prisma.friendship.findMany.mockResolvedValue([{ requesterId: 'u1', addresseeId: 'u2' }])
    prisma.chatMember.updateMany.mockResolvedValue({ count: 3 })

    await expect(service.mute('u1', 'f1', { minutes: 60, importantOnly: true })).resolves.toEqual({
      updated: 3,
    })
    const expected = ['saved', 'g1', 'p-friend']
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', chatId: { in: expected } },
      data: { mutedAt: null, mutedUntil: expect.any(Date), muteImportantOnly: true },
    })
    // Кандидаты — только мои незабаненные и не удалённые у себя чаты.
    expect(prisma.chatMember.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      bannedAt: null,
      hiddenAt: null,
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:list-changed', {
      chatIds: expected,
    })
  })

  it('снять заглушение папки; без правил разбираются только явные чаты', async () => {
    const { service, prisma } = foldersSetup()
    prisma.chatFolder.findFirst.mockResolvedValue({
      includeContacts: false,
      includeNonContacts: false,
      includeGroups: false,
      items: [{ chatId: 'c1', excluded: false }],
    })
    prisma.chatMember.findMany.mockResolvedValueOnce([{ chatId: 'c1', chat: { type: 'GROUP' } }])
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })
    await expect(service.unmute('u1', 'f1')).resolves.toEqual({ updated: 1 })
    expect(prisma.chatMember.findMany.mock.calls[0][0].where.chatId).toEqual({ in: ['c1'] })
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', chatId: { in: ['c1'] } },
      data: { mutedAt: null, mutedUntil: null, muteImportantOnly: false },
    })
    expect(prisma.friendship.findMany).not.toHaveBeenCalled()
  })

  it('чужая папка: заглушение — NOT_FOUND', async () => {
    const { service, prisma } = foldersSetup()
    prisma.chatFolder.findFirst.mockResolvedValue(null)
    await expect(service.mute('u1', 'чужая', {})).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })

  it('правка только исключений, пересекающихся с сохранённым составом, — 422', async () => {
    const { service, prisma } = foldersSetup()
    prisma.chatFolder.findFirst.mockResolvedValue({ id: 'f1' })
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c1' }])
    prisma.chatFolderItem.findFirst.mockResolvedValue({ chatId: 'c1' })
    await expect(service.update('u1', 'f1', { excludedChatIds: ['c1'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    // Сверяем с сохранёнными явными (excluded: false).
    expect(prisma.chatFolderItem.findFirst.mock.calls[0][0].where).toEqual({
      folderId: 'f1',
      excluded: false,
      chatId: { in: ['c1'] },
    })
    expect(prisma.chatFolder.update).not.toHaveBeenCalled()
  })

  it('перенос чата из исключений в явные: сначала удаление обоих списков, потом запись', async () => {
    const { service, prisma } = foldersSetup()
    prisma.chatFolder.findFirst.mockResolvedValue({ id: 'f1' })
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c1' }, { chatId: 'c2' }])
    prisma.chatFolder.findMany.mockResolvedValue([])
    await service
      .update('u1', 'f1', { chatIds: ['c1'], excludedChatIds: ['c2'], includeGroups: true })
      .catch(() => undefined)
    const deletes = prisma.chatFolderItem.deleteMany.mock.invocationCallOrder
    const write = prisma.chatFolderItem.createMany.mock.invocationCallOrder[0]!
    expect(deletes).toHaveLength(2)
    expect(Math.max(...deletes)).toBeLessThan(write)
    expect(prisma.chatFolderItem.createMany).toHaveBeenCalledWith({
      data: [
        { folderId: 'f1', chatId: 'c1', excluded: false },
        { folderId: 'f1', chatId: 'c2', excluded: true },
      ],
    })
    expect(prisma.chatFolder.update.mock.calls[0][0].data).toEqual({ includeGroups: true })
  })
})

// ── Избранные стикеры ─────────────────────────────────────────────────────────

function stickersSetup() {
  const models = {
    sticker: { findFirst: jest.fn() },
    favoriteSticker: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  }
  const prisma = {
    ...models,
    $transaction: jest.fn((fn: (tx: typeof models) => unknown) => fn(models)),
  }
  const files = { getPresignedUrls: jest.fn().mockResolvedValue(new Map()) }
  const realtime = { emitToUser: jest.fn() }
  const service = new ChatStickersService(
    prisma as unknown as PrismaService,
    files as never,
    {} as never,
    {} as never,
    {} as never,
    realtime as never,
  )
  return { service, prisma, files, realtime }
}

describe('Избранные стикеры', () => {
  it('добавление поднимает наверх; сверх лимита вытесняются самые давние', async () => {
    const { service, prisma, realtime } = stickersSetup()
    prisma.sticker.findFirst.mockResolvedValue({ id: 'st1' })
    prisma.favoriteSticker.findMany.mockResolvedValue([{ id: 'old-1' }])
    await service.addFavorite('u1', 'st1')
    expect(prisma.favoriteSticker.upsert).toHaveBeenCalledWith({
      where: { userId_stickerId: { userId: 'u1', stickerId: 'st1' } },
      create: { userId: 'u1', stickerId: 'st1' },
      update: { createdAt: expect.any(Date) },
    })
    expect(prisma.favoriteSticker.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: FAVORITE_STICKERS_MAX,
    })
    expect(prisma.favoriteSticker.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['old-1'] } },
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'stickers:favorites-changed', {})
  })

  it('стикер неопубликованного набора — NOT_FOUND, избранное не меняется', async () => {
    const { service, prisma } = stickersSetup()
    prisma.sticker.findFirst.mockResolvedValue(null)
    await expect(service.addFavorite('u1', 'st-скрытый')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.sticker.findFirst).toHaveBeenCalledWith({
      where: { id: 'st-скрытый', set: { isPublished: true } },
      select: { id: true },
    })
    expect(prisma.favoriteSticker.upsert).not.toHaveBeenCalled()
  })

  it('список — только опубликованные, свежие сверху, не больше 30, в форме стикера каталога', async () => {
    const { service, prisma, files } = stickersSetup()
    const sticker = { id: 'st1', emoji: '😀', width: 512, height: 512, order: 0, fileId: 'file1' }
    prisma.favoriteSticker.findMany.mockResolvedValue([{ sticker }])
    files.getPresignedUrls.mockResolvedValue(new Map([['file1', 'https://s/1']]))
    const list = await service.listFavorites('u1')
    expect(prisma.favoriteSticker.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', sticker: { set: { isPublished: true } } },
      take: FAVORITE_STICKERS_MAX,
    })
    expect(list).toEqual([
      {
        id: 'st1',
        emoji: '😀',
        width: 512,
        height: 512,
        url: 'https://s/1',
        expiresAt: expect.any(String),
      },
    ])
  })

  it('удаление идемпотентно', async () => {
    const { service, prisma } = stickersSetup()
    await expect(service.removeFavorite('u1', 'st1')).resolves.toBeUndefined()
    expect(prisma.favoriteSticker.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', stickerId: 'st1' },
    })
  })
})
