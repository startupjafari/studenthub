import { Role } from '@studenthub/shared-types'
import {
  CHAT_VIEW_COUNTED_TYPES,
  MessageSendRestSchema,
  MessageSendUploadedSchema,
  chatCountsViews,
} from '@studenthub/shared-schemas'
import { ChatsService } from './chats.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Данные сообщения как в Telegram: кружки (видеосообщения), просмотры в официальных чатах,
// миниатюра медиа в цитате ответа, время черновика.

function setup() {
  const prisma = {
    chatMember: {
      // По умолчанию — действующий участник.
      findUnique: jest.fn().mockResolvedValue({ id: 'mem', bannedAt: null }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    message: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'msg1',
        chatId: 'c1',
        senderId: 'u1',
        content: '',
        sender: { firstName: 'A', lastName: 'B' },
        media: [],
      }),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'msg1' }),
    },
    file: {
      // Привязка вложений: все запрошенные строки на месте.
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
    userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    hiddenMessage: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn(),
    // Аллокатор seq и счётчик просмотров — сырые запросы.
    $queryRaw: jest.fn().mockResolvedValue([{ last_seq: 1 }]),
  }
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma))
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    onlineAmong: jest.fn().mockReturnValue([]),
    usersInRoom: jest.fn().mockResolvedValue(new Set<string>()),
  }
  const files = {
    upload: jest.fn().mockResolvedValue({ id: 'f1', mime: 'video/webm' }),
    confirmDirectUpload: jest.fn().mockResolvedValue({ id: 'f1', mime: 'video/mp4' }),
    completeMultipart: jest.fn().mockResolvedValue({ id: 'f1', mime: 'video/mp4' }),
    delete: jest.fn().mockResolvedValue(undefined),
  }
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as never,
    realtime as never,
    files as never,
    {} as never,
    {} as never,
    { get: jest.fn().mockReturnValue('chat-media') } as never,
    redis as never,
    {} as never,
    {} as never,
    { invalidateUnread: jest.fn().mockResolvedValue(undefined) } as never,
  )
  // Уведомления о новом сообщении проверяет основная спека — здесь они не важны.
  jest
    .spyOn(service as unknown as { notifyNewMessage: () => Promise<void> }, 'notifyNewMessage')
    .mockResolvedValue(undefined)
  return { service, prisma, realtime, files }
}

const viewer = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

describe('Кружок (видеосообщение)', () => {
  it('multipart: единственное видео помечается кружком в той же транзакции', async () => {
    const { service, prisma, files } = setup()

    await service.sendMessageRest('u1', { chatId: 'c1', videoNote: true }, [
      { buffer: Buffer.from('v'), name: 'round.webm' },
    ])

    expect(files.upload).toHaveBeenCalledTimes(1)
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] }, messageId: null },
      data: { messageId: 'msg1' },
    })
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] } },
      data: { videoNote: true },
    })
  })

  it('без флага кружком ничего не помечается', async () => {
    const { service, prisma } = setup()

    await service.sendMessageRest('u1', { chatId: 'c1' }, [{ buffer: Buffer.from('v') }])

    const noteCall = prisma.file.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { videoNote?: boolean } }).data.videoNote,
    )
    expect(noteCall).toBeUndefined()
  })

  it('кружок из двух файлов или «файлом» отклоняется до загрузки', async () => {
    const { service, files, prisma } = setup()

    const two = await service
      .sendMessageRest('u1', { chatId: 'c1', videoNote: true }, [
        { buffer: Buffer.from('a') },
        { buffer: Buffer.from('b') },
      ])
      .catch((e) => e)
    const asFile = await service
      .sendMessageRest('u1', { chatId: 'c1', videoNote: true, asFiles: true }, [
        { buffer: Buffer.from('a') },
      ])
      .catch((e) => e)

    expect(two.code).toBe('BAD_REQUEST')
    expect(asFile.code).toBe('BAD_REQUEST')
    expect(files.upload).not.toHaveBeenCalled()
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('не видео по содержимому — отказ, загруженное убирается, сообщения нет', async () => {
    const { service, files, prisma, realtime } = setup()
    files.upload.mockResolvedValueOnce({ id: 'f1', mime: 'image/png' })

    const err = await service
      .sendMessageRest('u1', { chatId: 'c1', videoNote: true }, [{ buffer: Buffer.from('p') }])
      .catch((e) => e)

    expect(err.code).toBe('BAD_REQUEST')
    expect(files.delete).toHaveBeenCalledWith('f1')
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })

  it('прямая загрузка: кружок по ключу объекта', async () => {
    const { service, prisma } = setup()

    await service.sendMessageFromUploads('u1', 'c1', {
      videoNote: true,
      attachments: [{ key: 'u1/round.mp4' }],
    })

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] } },
      data: { videoNote: true },
    })
  })

  it('прямая загрузка: кружок из двух объектов отклоняется до подтверждения', async () => {
    const { service, files } = setup()

    const err = await service
      .sendMessageFromUploads('u1', 'c1', {
        videoNote: true,
        attachments: [{ key: 'u1/a.mp4' }, { key: 'u1/b.mp4' }],
      })
      .catch((e) => e)

    expect(err.code).toBe('BAD_REQUEST')
    expect(files.confirmDirectUpload).not.toHaveBeenCalled()
  })

  it('схемы принимают флаг: multipart строкой, JSON — булевым', () => {
    const rest = MessageSendRestSchema.safeParse({ chatId: 'c1', videoNote: 'true' })
    expect(rest.success && rest.data.videoNote).toBe(true)
    const uploaded = MessageSendUploadedSchema.safeParse({
      videoNote: true,
      attachments: [{ key: 'u1/round.mp4' }],
    })
    expect(uploaded.success && uploaded.data.videoNote).toBe(true)
  })
})

describe('Просмотры сообщений официального чата', () => {
  it('просмотры есть у официальных чатов и нет у личных, групп, «Сохранённых» и поддержки', () => {
    for (const type of ['GROUP_OFFICIAL', 'SUBJECT', 'FACULTY', 'DEAN', 'EVENT']) {
      expect(chatCountsViews(type)).toBe(true)
    }
    for (const type of ['PRIVATE', 'GROUP', 'SAVED', 'SUPPORT', 'SUPPORT_PLATFORM']) {
      expect(chatCountsViews(type)).toBe(false)
    }
    expect(CHAT_VIEW_COUNTED_TYPES).not.toContain('PRIVATE')
  })

  it('не участник — WRONG_SCOPE, счётчик не считается', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)

    const err = await service.getMessageViews('u1', 'c1', ['m1']).catch((e) => e)

    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('забаненный участник — FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce({ id: 'mem', bannedAt: new Date() })

    const err = await service.getMessageViews('u1', 'c1', ['m1']).catch((e) => e)

    expect(err.code).toBe('FORBIDDEN')
  })

  it('в личном чате — пустой ответ без запроса к сообщениям', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({ type: 'PRIVATE' })

    const res = await service.getMessageViews('u1', 'c1', ['m1'])

    expect(res).toEqual({ views: [] })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('в чате факультета — уникальные просмотры одним запросом, числа без bigint', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({ type: 'FACULTY' })
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'm1', views: BigInt(42) },
      { id: 'm2', views: BigInt(0) },
    ])

    const res = await service.getMessageViews('u1', 'c1', ['m1', 'm2', 'm1'])

    expect(res).toEqual({
      views: [
        { id: 'm1', views: 42 },
        { id: 'm2', views: 0 },
      ],
    })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    // Запрос ограничен этим чатом и считает отметки прочтения других участников.
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]]
    const sql = strings.join('?')
    expect(sql).toContain('cm.user_id <> m.sender_id')
    expect(sql).toContain('cm.last_read_at >= m.created_at')
    expect(sql).toContain('m.deleted_at IS NULL')
    expect(values).toContain('c1')
  })
})

describe('Миниатюра медиа в цитате ответа', () => {
  it('история читает первое вложение оригинала; у удалённого оригинала оно вычищается', async () => {
    const { service, prisma } = setup()
    const deletedAt = new Date()
    prisma.message.findMany.mockResolvedValueOnce([
      {
        id: 'r1',
        replyQuote: null,
        replyTo: {
          id: 'x',
          content: 'фото',
          senderId: 'u2',
          deletedAt,
          sender: {},
          media: [{ id: 'f9', mime: 'image/jpeg', placeholder: 'data:', spoiler: false }],
        },
        sharedPost: null,
      },
      {
        id: 'r2',
        replyQuote: null,
        replyTo: {
          id: 'y',
          content: '',
          senderId: 'u2',
          deletedAt: null,
          sender: {},
          media: [{ id: 'f8', mime: 'video/mp4', placeholder: null, videoNote: true }],
        },
        sharedPost: null,
      },
    ])

    const res = await service.getMessages(viewer('u1'), 'c1', { limit: 20 })

    const select = prisma.message.findMany.mock.calls[0][0].select
    expect(select.replyTo.select.media).toMatchObject({ take: 1, orderBy: { createdAt: 'asc' } })
    expect(select.replyTo.select.media.select).toMatchObject({
      id: true,
      mime: true,
      placeholder: true,
      videoNote: true,
    })
    expect(select.media.select.videoNote).toBe(true)
    const [deleted, alive] = res.items
    expect(deleted?.replyTo?.media).toEqual([])
    expect(alive?.replyTo?.media).toEqual([
      { id: 'f8', mime: 'video/mp4', placeholder: null, videoNote: true },
    ])
  })
})

describe('Время черновика', () => {
  it('сохранение ставит draftAt, пустой текст снимает оба поля', async () => {
    const { service, prisma } = setup()
    const before = Date.now()

    const saved = await service.saveDraft('u1', 'c1', '  привет  ')
    const cleared = await service.saveDraft('u1', 'c1', '   ')

    expect(saved.draft).toBe('привет')
    expect(saved.draftAt?.getTime()).toBeGreaterThanOrEqual(before)
    expect(prisma.chatMember.updateMany).toHaveBeenNthCalledWith(1, {
      where: { chatId: 'c1', userId: 'u1' },
      data: { draft: 'привет', draftAt: saved.draftAt },
    })
    expect(cleared).toEqual({ chatId: 'c1', draft: null, draftAt: null })
    expect(prisma.chatMember.updateMany).toHaveBeenNthCalledWith(2, {
      where: { chatId: 'c1', userId: 'u1' },
      data: { draft: null, draftAt: null },
    })
  })

  it('не участник — черновик не сохраняется', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)

    const err = await service.saveDraft('u1', 'c1', 'текст').catch((e) => e)

    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })
})
