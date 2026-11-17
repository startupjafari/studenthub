import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  MessageEditSchema,
  MessageForwardBatchSchema,
  MessageSendSchema,
  firstLinkUrl,
} from '@studenthub/shared-schemas'
import { QUEUES } from '../../common/queue/queue.constants'
import { ChatsService } from './chats.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Флаги поля ввода в стиле Telegram: «без превью ссылки» (плашку над полем закрыли) у
// отправки, правки и комментария к пересылке; «скрыть подписи» у пересылки пачкой.

function setup() {
  const prisma = {
    chatMember: {
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
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    hiddenMessage: { findMany: jest.fn().mockResolvedValue([]) },
    file: {
      findMany: jest.fn().mockResolvedValue([]),
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
    { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    { get: jest.fn().mockReturnValue('chat-media') } as never,
    redis as never,
    {} as never,
    {} as never,
    {} as never,
  )
  /** Job'ы выборки превью — уведомления о новом сообщении идут в ту же очередь-заглушку. */
  const previewJobs = () =>
    queue.enqueue.mock.calls.filter((c: unknown[]) => c[0] === QUEUES.LINK_PREVIEW)
  return { service, prisma, queue, previewJobs }
}

const viewer = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

function row(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    chatId: 'c1',
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

describe('firstLinkUrl — общая для сервера и плашки над полем ввода', () => {
  it('первая http(s)-ссылка, без хвостовых кавычек и угловых скобок', () => {
    expect(firstLinkUrl('см. https://a.example/x и http://b.example')).toBe('https://a.example/x')
    expect(firstLinkUrl('<https://a.example/x>')).toBe('https://a.example/x')
    expect(firstLinkUrl('ftp://a.example и a.example')).toBeUndefined()
    expect(firstLinkUrl(null)).toBeUndefined()
  })
})

describe('Схемы: флаги необязательные — старые клиенты не ломаются', () => {
  it('MessageSendSchema принимает noLinkPreview и отправку без него', () => {
    expect(MessageSendSchema.safeParse({ chatId: 'c1', content: 'hi' }).success).toBe(true)
    expect(
      MessageSendSchema.safeParse({ chatId: 'c1', content: 'hi', noLinkPreview: true }).success,
    ).toBe(true)
    expect(
      MessageSendSchema.safeParse({ chatId: 'c1', content: 'hi', noLinkPreview: 'yes' }).success,
    ).toBe(false)
  })

  it('MessageEditSchema и MessageForwardBatchSchema принимают новые флаги', () => {
    expect(
      MessageEditSchema.safeParse({ messageId: 'm1', content: 'x', noLinkPreview: true }).success,
    ).toBe(true)
    const batch = {
      messageIds: ['11111111-1111-4111-8111-111111111111'],
      chatIds: ['22222222-2222-4222-8222-222222222222'],
      requestId: '33333333-3333-4333-8333-333333333333',
    }
    expect(MessageForwardBatchSchema.safeParse(batch).success).toBe(true)
    expect(
      MessageForwardBatchSchema.safeParse({ ...batch, hideCaptions: true, noLinkPreview: true })
        .success,
    ).toBe(true)
  })
})

describe('Отправка: noLinkPreview', () => {
  it('без флага — job превью первой ссылки', async () => {
    const { service, prisma, previewJobs } = setup()
    prisma.message.create.mockResolvedValue(row('m1', { content: 'см. https://a.example/x' }))
    await service.createMessage('u1', { chatId: 'c1', content: 'см. https://a.example/x' })
    expect(previewJobs()).toHaveLength(1)
    expect(previewJobs()[0]?.[2]).toEqual({
      messageId: 'm1',
      chatId: 'c1',
      url: 'https://a.example/x',
    })
  })

  it('с флагом — сообщение уходит, превью не строится', async () => {
    const { service, prisma, previewJobs } = setup()
    prisma.message.create.mockResolvedValue(row('m1', { content: 'см. https://a.example/x' }))
    const res = await service.createMessage('u1', {
      chatId: 'c1',
      content: 'см. https://a.example/x',
      noLinkPreview: true,
    })
    expect(res.message.id).toBe('m1')
    expect(previewJobs()).toHaveLength(0)
    // Флаг — указание серверу, а не поле сообщения: в БД его нет.
    expect(prisma.message.create.mock.calls[0][0].data).not.toHaveProperty('noLinkPreview')
  })
})

describe('Правка: noLinkPreview', () => {
  function editable(ctx: ReturnType<typeof setup>) {
    ctx.prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      content: 'см. https://a.example/x',
    })
    ctx.prisma.message.update.mockResolvedValue(row('m1'))
  }

  it('та же ссылка, превью закрыли — карточка снимается, новой выборки нет', async () => {
    const ctx = setup()
    editable(ctx)
    await ctx.service.editMessage('u1', 'm1', 'смотри https://a.example/x', {
      noLinkPreview: true,
    })
    expect(ctx.prisma.message.update.mock.calls[0][0].data).toMatchObject({
      linkPreview: Prisma.DbNull,
    })
    expect(ctx.previewJobs()).toHaveLength(0)
  })

  it('новая ссылка с закрытым превью — старая карточка снята, новая не строится', async () => {
    const ctx = setup()
    editable(ctx)
    await ctx.service.editMessage('u1', 'm1', 'см. https://b.example/y', { noLinkPreview: true })
    expect(ctx.prisma.message.update.mock.calls[0][0].data).toMatchObject({
      linkPreview: Prisma.DbNull,
    })
    expect(ctx.previewJobs()).toHaveLength(0)
  })

  it('без флага поведение прежнее: новая ссылка — новый job', async () => {
    const ctx = setup()
    editable(ctx)
    await ctx.service.editMessage('u1', 'm1', 'см. https://b.example/y')
    expect(ctx.previewJobs()).toHaveLength(1)
  })
})

describe('Пересылка пачкой: hideCaptions и noLinkPreview комментария', () => {
  const requestId = '11111111-1111-4111-8111-111111111111'

  function withSources(ctx: ReturnType<typeof setup>) {
    const base = {
      chatId: 'c0',
      linkPreview: null,
      sharedPostId: null,
      stickerId: null,
      poll: null,
      location: null,
      contact: null,
      checklist: null,
    }
    const sources = [
      {
        ...base,
        id: 'photo',
        seq: 1,
        createdAt: new Date('2026-11-01T10:01:00Z'),
        content: 'подпись к снимку https://a.example/x',
        linkPreview: { url: 'https://a.example/x', title: 'A' },
        media: [
          {
            id: 'f1',
            bucket: 'chat-media',
            key: 'k1',
            mime: 'image/jpeg',
            size: 10,
            name: 'a.jpg',
            width: 1,
            height: 1,
            spoiler: false,
            asDocument: false,
          },
        ],
      },
      {
        ...base,
        id: 'text',
        seq: 2,
        createdAt: new Date('2026-11-01T10:02:00Z'),
        content: 'просто текст',
        media: [],
      },
    ]
    // Источники — по запрошенным id, как и в настоящем запросе.
    ctx.prisma.message.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(sources.filter((source) => where.id.in.includes(source.id))),
    )
    let n = 0
    ctx.prisma.message.create.mockImplementation(() => {
      n += 1
      return Promise.resolve(row(`new-${n}`))
    })
    ctx.prisma.message.findUniqueOrThrow.mockImplementation(
      ({ where }: { where: { id: string } }) => Promise.resolve(row(where.id)),
    )
  }

  const created = (ctx: ReturnType<typeof setup>) =>
    ctx.prisma.message.create.mock.calls.map(
      (c: [{ data: { content: string; forwardedFromId?: string; linkPreview?: unknown } }]) =>
        c[0].data,
    )

  it('hideCaptions: у вложений текст снят, у текстового сообщения — остался; имя скрыто', async () => {
    const ctx = setup()
    withSources(ctx)
    await ctx.service.forwardBatch(viewer('u1'), {
      messageIds: ['photo', 'text'],
      chatIds: ['c1'],
      requestId,
      hideCaptions: true,
    })
    const [photo, text] = created(ctx)
    expect(photo?.content).toBe('')
    // Превью подписи уходит вместе с подписью, и доставать его заново незачем.
    expect(photo?.linkPreview).toBeUndefined()
    expect(text?.content).toBe('просто текст')
    // Подпись без автора — уже не его слова: «скрыть подписи» скрывает и имя.
    expect(photo?.forwardedFromId).toBeUndefined()
    expect(text?.forwardedFromId).toBeUndefined()
    expect(ctx.previewJobs()).toHaveLength(0)
  })

  it('без hideCaptions подпись и превью переносятся как были', async () => {
    const ctx = setup()
    withSources(ctx)
    await ctx.service.forwardBatch(viewer('u1'), {
      messageIds: ['photo'],
      chatIds: ['c1'],
      requestId,
    })
    const [photo] = created(ctx)
    expect(photo?.content).toBe('подпись к снимку https://a.example/x')
    expect(photo?.forwardedFromId).toBe('photo')
    expect(photo?.linkPreview).toEqual({ url: 'https://a.example/x', title: 'A' })
  })

  it('комментарий со ссылкой и noLinkPreview — без job превью; без флага — с ним', async () => {
    const off = setup()
    withSources(off)
    await off.service.forwardBatch(viewer('u1'), {
      messageIds: ['text'],
      chatIds: ['c1'],
      comment: 'гляньте https://c.example/z',
      requestId,
      noLinkPreview: true,
    })
    expect(created(off)[0]?.content).toBe('гляньте https://c.example/z')
    expect(off.previewJobs()).toHaveLength(0)

    const on = setup()
    withSources(on)
    await on.service.forwardBatch(viewer('u1'), {
      messageIds: ['text'],
      chatIds: ['c1'],
      comment: 'гляньте https://c.example/z',
      requestId,
    })
    expect(on.previewJobs().map((c: unknown[]) => (c[2] as { url: string }).url)).toEqual([
      'https://c.example/z',
    ])
  })
})
