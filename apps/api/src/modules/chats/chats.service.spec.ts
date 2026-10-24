import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { MessageSendRestSchema } from '@studenthub/shared-schemas'
import { ChatsService } from './chats.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'
import type { RealtimeGateway } from '../../common/realtime'
import type { FileService } from '../files/file.service'
import type { PostsService } from '../posts/posts.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

function setup() {
  const prisma = {
    chatMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    message: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
    },
    messageReaction: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'f1', variants: [] }),
      // Привязка вложений к сообщению: по умолчанию все запрошенные строки на месте.
      updateMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: { in?: string[] } } }) =>
          Promise.resolve({ count: where.id?.in?.length ?? 0 }),
        ),
    },
    chat: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      // По умолчанию — GROUP без участников: проверка личной блокировки завершается сразу.
      // requestPendingForId: null — обычный чат, запрос на переписку (§50) не висит.
      findUnique: jest.fn().mockResolvedValue({
        type: 'GROUP',
        members: [],
        requestPendingForId: null,
      }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    // §50: по умолчанию — не друзья, поэтому переписка начинается с запроса.
    friendship: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notification: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    pair: { findMany: jest.fn().mockResolvedValue([]) },
    chatPoll: { findUnique: jest.fn(), create: jest.fn() },
    chatPollVote: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
    // Аллокатор Message.seq — сырой UPDATE ... RETURNING. По умолчанию выдаёт первый номер.
    $queryRaw: jest.fn().mockResolvedValue([{ last_seq: 1 }]),
    // Транзакционный advisory-лок (advisoryXactLock): вторым аргументом шаблона — ключ.
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  // $transaction(cb) прогоняет колбэк с тем же prisma-моком в роли tx.
  prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma))
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    leaveRoom: jest.fn(),
    onlineAmong: jest.fn().mockReturnValue([]),
    usersInRoom: jest.fn().mockResolvedValue(new Set<string>()),
  }
  const files = {
    upload: jest.fn().mockResolvedValue({ id: 'f1' }),
    confirmDirectUpload: jest.fn().mockResolvedValue({ id: 'f1' }),
    completeMultipart: jest.fn().mockResolvedValue({ id: 'f1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn(),
    findOrThrow: jest.fn(),
    copyToMessage: jest.fn().mockResolvedValue({ id: 'copy-1' }),
  }
  const posts = { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('chat-media') }
  // Описание медиа собирает MediaService (его спека — media.service.spec.ts); здесь важно,
  // что оно выдаётся только вместе с проверенной ссылкой.
  const media = {
    describeOne: jest.fn().mockResolvedValue({ status: 'READY', sources: [] }),
    describe: jest.fn().mockResolvedValue(new Map()),
  }
  // set→'OK' = флаг захвачен, провижининг официальных чатов выполняется (как до троттлинга).
  // incr/expire — антифлуд отправки (assertNotFlooding): 1 = первое сообщение в окне.
  const redis = {
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }
  // Журнал выгрузок проверяется своим тестом (common/export) — здесь заглушка.
  const exportRegistry = {
    register: jest.fn().mockResolvedValue({ id: 'e-1', shortId: 'ABCD2345' }),
  }
  // Кэш счётчика непрочитанных (NotificationsService) — сбрасывается при снятии уведомлений.
  const notifications = { invalidateUnread: jest.fn().mockResolvedValue(undefined) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    realtime as unknown as RealtimeGateway,
    files as unknown as FileService,
    posts as unknown as PostsService,
    config as unknown as ConfigService<EnvVars, true>,
    redis as never,
    exportRegistry as never,
    media as never,
    notifications as never,
  )
  return {
    service,
    prisma,
    queue,
    realtime,
    files,
    posts,
    config,
    redis,
    exportRegistry,
    media,
    notifications,
  }
}

const user = (sub: string): JwtPayload => ({
  sub,
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
})

describe('ChatsService — членство', () => {
  it('assertMembership бросает WRONG_SCOPE, если не участник', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.assertMembership('u1', 'c1').catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('isMember true/false', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValueOnce({ id: 'm1', bannedAt: null })
    expect(await service.isMember('u1', 'c1')).toBe(true)
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    expect(await service.isMember('u1', 'c2')).toBe(false)
    // Забаненный в комнату чата не входит: иначе читал бы группу вживую через сокет.
    prisma.chatMember.findUnique.mockResolvedValueOnce({ id: 'm1', bannedAt: new Date() })
    expect(await service.isMember('u1', 'c3')).toBe(false)
  })
})

describe('ChatsService.createMessage', () => {
  it('не участник → WRONG_SCOPE, без создания', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.createMessage('u1', { chatId: 'c1', content: 'hi' }).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('участник → создаёт сообщение и ставит job new-message получателям', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'hi',
      replyToId: null,
      editedAt: null,
      createdAt: new Date(),
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }])
    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi' })
    expect(res.message.id).toBe('msg1')
    expect(res.recipientIds).toEqual(['u2', 'u3'])
    const jobData = queue.enqueue.mock.calls[0][2]
    expect(jobData.type).toBe('MESSAGE')
    expect(jobData.dedupeKey).toBe('new-message:msg1')
    expect(new Set(jobData.recipientIds)).toEqual(new Set(['u2', 'u3']))
  })

  // BUG-160: цитату нельзя наполнить словами, которых в оригинале нет.
  it('цитата не из оригинала → BAD_REQUEST, сообщение не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue({ id: 'dean-msg', content: 'Пересдача в пятницу' })
    const err = await service
      .createMessage('u1', {
        chatId: 'c1',
        content: 'ок',
        replyToId: 'dean-msg',
        replyQuote: 'Пересдачи не будет',
      })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('цитата из отрисованного текста (без разметки и переносов) принимается', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue({
      id: 'dean-msg',
      content: 'Пересдача **в пятницу**,\nаудитория 305',
    })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'ок',
      createdAt: new Date(),
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    await service.createMessage('u1', {
      chatId: 'c1',
      content: 'ок',
      replyToId: 'dean-msg',
      replyQuote: 'в пятницу, аудитория',
    })
    expect(prisma.message.create.mock.calls[0][0].data.replyQuote).toBe('в пятницу, аудитория')
  })
})

// F-F03: автор обращения дописывает из окна чата обычной отправкой — правила обращения
// (переоткрыть, разбудить команду) обязаны сработать и на этом пути.
describe('ChatsService — сообщения в обращениях поддержки', () => {
  const row = (senderId: string) => ({
    id: 'msg1',
    chatId: 'ticket-1',
    seq: 7,
    senderId,
    content: 'скриншот',
    createdAt: new Date(),
    sender: { id: senderId, firstName: 'A', lastName: 'B', avatarUrl: null },
  })

  it('сообщение в SUPPORT_PLATFORM уходит в правила обращения; команда без уведомления', async () => {
    const { service, prisma, queue } = setup()
    const hook = jest.fn().mockResolvedValue(new Set(['staff-1']))
    service.registerSupportHook(hook)
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue({
      type: 'SUPPORT_PLATFORM',
      members: [],
      requestPendingForId: null,
    })
    prisma.message.create.mockResolvedValue(row('author-1'))
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'staff-1' }, { userId: 'staff-2' }])

    const res = await service.createMessage('author-1', { chatId: 'ticket-1', content: 'скриншот' })

    expect(hook).toHaveBeenCalledWith({ chatId: 'ticket-1', senderId: 'author-1', seq: 7 })
    expect(res.recipientIds).toEqual(['staff-2'])
    expect(queue.enqueue.mock.calls[0][2].recipientIds).toEqual(['staff-2'])
  })

  it('в обычных чатах правила обращения не зовутся', async () => {
    const { service, prisma } = setup()
    const hook = jest.fn().mockResolvedValue(new Set())
    service.registerSupportHook(hook)
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue(row('u1'))

    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    expect(hook).not.toHaveBeenCalled()
  })
})

describe('ChatsService.editMessage / deleteMessage — только автор', () => {
  it('правка чужого сообщения → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', senderId: 'other' })
    const err = await service.editMessage('u1', 'm1', 'x').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('правка своего свежего сообщения (<10 мин) — успешно', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: null })
    prisma.message.update.mockResolvedValue({ id: 'm1', content: 'x' })
    const res = await service.editMessage('u1', 'm1', 'x')
    expect(res.id).toBe('m1')
    expect(prisma.message.update).toHaveBeenCalled()
  })

  // BUG-112: заменённая ссылка не должна оставаться под карточкой старой.
  it('правка, заменившая ссылку, сбрасывает превью и ставит новый job', async () => {
    const { service, prisma, queue } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      content: 'см. https://a.example/x',
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: null })
    prisma.message.update.mockResolvedValue({ id: 'm1', chatId: 'c1', content: 'x' })

    await service.editMessage('u1', 'm1', 'см. https://b.example/y')

    expect(prisma.message.update.mock.calls[0][0].data).toMatchObject({
      linkPreview: Prisma.DbNull,
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { messageId: 'm1', chatId: 'c1', url: 'https://b.example/y' },
      expect.objectContaining({ jobId: expect.stringMatching(/^link-preview:m1:\d+$/) }),
    )
  })

  it('правка без смены ссылки превью не трогает', async () => {
    const { service, prisma, queue } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      content: 'см. https://a.example/x',
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: null })
    prisma.message.update.mockResolvedValue({ id: 'm1', chatId: 'c1', content: 'x' })

    await service.editMessage('u1', 'm1', 'смотри https://a.example/x')

    expect(prisma.message.update.mock.calls[0][0].data).not.toHaveProperty('linkPreview')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  // BUG-161: подпись «Переслано от X» не должна стоять над чужими словами, которых X не писал.
  it('правка пересланного сообщения → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      forwardedFromId: 'src',
    })
    const err = await service.editMessage('u1', 'm1', 'x').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('правка своего старого сообщения (>10 мин) → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: null })
    const err = await service.editMessage('u1', 'm1', 'x').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('удаление чужого сообщения → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', senderId: 'other', chatId: 'c1' })
    const err = await service.deleteMessage('u1', 'm1').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  // F-F16: исключённый или забаненный автор своё больше не правит и не удаляет.
  it('забаненный автор не правит своё свежее сообщение', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: new Date() })
    const err = await service.editMessage('u1', 'm1', 'оскорбление').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('исключённый автор не правит своё сообщение', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
    })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.editMessage('u1', 'm1', 'x').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.chatMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId_userId: { chatId: 'c1', userId: 'u1' } } }),
    )
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('забаненный автор не удаляет своё сообщение', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', senderId: 'u1', chatId: 'c1', seq: 3 })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: new Date() })
    const err = await service.deleteMessage('u1', 'm1').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('участник удаляет своё сообщение', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', senderId: 'u1', chatId: 'c1', seq: 3 })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: null })
    prisma.chat.findUnique.mockResolvedValue({ lastSeq: 9 })
    await expect(service.deleteMessage('u1', 'm1')).resolves.toEqual({ chatId: 'c1' })
    expect(prisma.message.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { deletedAt: expect.any(Date) },
    })
  })
})

// F-F15: «печатает» в большом чате — только от участника.
describe('ChatsService.actionAudience', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }))

  it('большой чат: не участник получает отказ, а не рассылку по комнате', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue(many(65))
    prisma.chatMember.findUnique.mockResolvedValue(null)
    await expect(service.actionAudience('stranger', 'c1')).resolves.toEqual({ kind: 'denied' })
    expect(prisma.chatMember.findUnique).toHaveBeenCalledWith({
      where: { chatId_userId: { chatId: 'c1', userId: 'stranger' } },
      select: { id: true, bannedAt: true },
    })
  })

  it('большой чат: забаненный тоже не печатает', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue(many(65))
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: new Date() })
    await expect(service.actionAudience('u70', 'c1')).resolves.toEqual({ kind: 'denied' })
  })

  it('большой чат: участнику — рассылка по комнате', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue(many(65))
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    await expect(service.actionAudience('u70', 'c1')).resolves.toEqual({ kind: 'room' })
  })

  it('небольшой чат: членство по уже прочитанному составу, без второго запроса', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue(many(3))
    await expect(service.actionAudience('u1', 'c1')).resolves.toEqual({
      kind: 'users',
      userIds: ['u0', 'u2'],
    })
    expect(prisma.chatMember.findUnique).not.toHaveBeenCalled()
  })
})

describe('ChatsService.getMessages — cursor + членство', () => {
  it('не участник → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.getMessages(user('u1'), 'c1', { limit: 20 }).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('участник → cursor-страница (take limit+1, hasNext)', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `m${i}` })),
    )
    const res = await service.getMessages(user('u1'), 'c1', { limit: 20 })
    expect(res.items).toHaveLength(20)
    expect(res.meta.hasNext).toBe(true)
    expect(res.meta.cursor).toBe('m19')
    expect(prisma.message.findMany.mock.calls[0][0].take).toBe(21)
  })

  it('around → окно: новее(desc) + целевое + старее(desc), meta старых и новых', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue({ id: 'mT', seq: 500 })
    prisma.message.findMany
      // 1-й вызов — старее (desc), 21 > limit → есть ещё старые
      .mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => ({ id: `o${i}` })))
      // 2-й вызов — новее (asc), 5 ≤ limit → больше новых нет
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` })))
    prisma.message.findUnique.mockResolvedValue({ id: 'mT' })

    const res = await service.getMessages(user('u1'), 'c1', { limit: 20, around: 'mT' })

    expect(res.items).toHaveLength(26) // 5 новее + 1 целевое + 20 старее
    expect(res.items[0]?.id).toBe('n4') // новее развёрнуты в desc
    expect(res.items[5]?.id).toBe('mT')
    expect(res.items[25]?.id).toBe('o19')
    expect(res.meta.hasNext).toBe(true) // старее было 21 > 20
    expect(res.meta.cursor).toBe('o19')
    expect(res.meta.hasPrev).toBe(false) // новее было 5 ≤ 20
    expect(res.meta.prevCursor).toBe('n4')
  })

  it('around → целевое не найдено → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue(null)
    const err = await service
      .getMessages(user('u1'), 'c1', { limit: 20, around: 'nope' })
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  // Регрессия: очищенная «у себя» история всплывала при переходе по дате. Спред
  // `{ ...baseWhere, createdAt: {...} }` перетирал границу clearedAt (ключ тот же), якорем
  // становилось скрытое сообщение, а целевое дочитывалось по id в обход всех фильтров.
  it('aroundDate: граница clearedAt не теряется при поиске якоря', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-08-20T00:00:00.000Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', clearedAt })
    prisma.message.findFirst.mockResolvedValue({ id: 'mT', createdAt: new Date() })

    await service.getMessages(user('u1'), 'c1', {
      limit: 20,
      aroundDate: '2026-08-12T00:00:00.000Z',
    })

    const where = prisma.message.findFirst.mock.calls[0][0].where
    // Оба условия обязаны дожить до запроса: и граница очистки, и искомая дата.
    // Граница лежит во вложенном AND — там же, где и вырезанные периоды (clearedWhere).
    expect(where.AND).toEqual([
      expect.objectContaining({ AND: [{ createdAt: { gt: clearedAt } }] }),
      { createdAt: { gte: new Date('2026-08-12T00:00:00.000Z') } },
    ])
  })

  it('aroundDate: целевое сообщение читается под теми же фильтрами, а не по одному id', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-08-20T00:00:00.000Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', clearedAt })
    prisma.message.findFirst.mockResolvedValue({ id: 'mT', createdAt: new Date() })

    await service.getMessages(user('u1'), 'c1', {
      limit: 20,
      aroundDate: '2026-08-12T00:00:00.000Z',
    })

    // Второй findFirst — целевое сообщение окна.
    const where = prisma.message.findFirst.mock.calls[1][0].where
    expect(where).toMatchObject({
      id: 'mT',
      deletedAt: null,
      AND: [{ createdAt: { gt: clearedAt } }],
    })
    // Выборка по одному id мимо фильтров вернула бы очищенное сообщение.
    expect(prisma.message.findUnique).not.toHaveBeenCalled()
  })

  it('direction=newer → отдаёт новые в desc, meta.hasPrev/prevCursor', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    // Курсор сперва превращается в seq, и только потом идёт выборка.
    prisma.message.findFirst.mockResolvedValue({ seq: 100 })
    // asc-выборка (21 > limit → есть ещё новые); в ответе — desc.
    prisma.message.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ id: `n${i}` })),
    )
    const res = await service.getMessages(user('u1'), 'c1', {
      limit: 20,
      cursor: 'n-1',
      direction: 'newer',
    })
    expect(res.items).toHaveLength(20)
    expect(res.items[0]?.id).toBe('n19') // развёрнуто в desc
    expect(res.meta.hasPrev).toBe(true)
    expect(res.meta.prevCursor).toBe('n19')
    const call = prisma.message.findMany.mock.calls[0][0]
    expect(call.orderBy).toEqual({ seq: 'asc' })
    expect(call.where.seq).toEqual({ gt: 100 })
  })

  // Курсор Prisma раскладывался в OR по времени, который планировщик брал фильтром:
  // проход шёл от новейшего сообщения и выбрасывал всё, что новее курсора, поэтому
  // страница стоила тем дороже, чем она глубже. Граница по seq ложится в индекс
  // [chatId, seq], и стоимость перестаёт зависеть от глубины — но только пока запрос
  // действительно ходит по seq, а не по cursor/skip. Это и стережёт тест.
  it('страница истории по курсору — граница seq, а не cursor/skip Prisma', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue({ seq: 777 })
    prisma.message.findMany.mockResolvedValue([])

    await service.getMessages(user('u1'), 'c1', { limit: 20, cursor: 'mX' })

    // Курсор ищется В ЭТОМ чате: сообщение из чужого не должно задавать границу.
    expect(prisma.message.findFirst.mock.calls[0][0].where).toEqual({ id: 'mX', chatId: 'c1' })
    const call = prisma.message.findMany.mock.calls[0][0]
    expect(call.where.seq).toEqual({ lt: 777 })
    expect(call.orderBy).toEqual({ seq: 'desc' })
    expect(call.cursor).toBeUndefined()
    expect(call.skip).toBeUndefined()
  })

  it('курсор не из этого чата → пустая страница, а не чужая граница', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue(null)

    const res = await service.getMessages(user('u1'), 'c1', { limit: 20, cursor: 'чужой' })

    expect(res.items).toEqual([])
    expect(res.meta.hasNext).toBe(false)
    expect(prisma.message.findMany).not.toHaveBeenCalled()
  })

  // BUG-070/096: удалённое не отдаётся и чужой связью — ни цитатой ответа, ни карточкой поста.
  it('цитата удалённого оригинала и карточка снятого поста приходят пустыми', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    const deletedAt = new Date()
    prisma.message.findMany.mockResolvedValue([
      {
        id: 'reply',
        replyQuote: 'кусок удалённого',
        replyTo: { id: 'x', content: 'удалённый текст', senderId: 'u2', deletedAt, sender: {} },
        sharedPost: {
          id: 'p1',
          title: 'Снятый пост',
          content: 'текст поста',
          authorId: 'u3',
          deletedAt,
          author: { id: 'u3', firstName: 'A', lastName: 'B', avatarUrl: null },
          media: [{ id: 'f1', mime: 'image/png' }],
          _count: { comments: 4, reactions: 9 },
        },
      },
      {
        id: 'alive',
        replyQuote: 'живая цитата',
        replyTo: { id: 'y', content: 'живой текст', senderId: 'u2', deletedAt: null, sender: {} },
        sharedPost: null,
      },
    ])

    const res = await service.getMessages(user('u1'), 'c1', { limit: 20 })

    const [reply, alive] = res.items
    expect(reply?.replyQuote).toBeNull()
    expect(reply?.replyTo).toMatchObject({ id: 'x', content: '', deletedAt })
    expect(reply?.sharedPost).toMatchObject({
      id: 'p1',
      title: null,
      content: '',
      author: null,
      media: [],
      deletedAt,
    })
    // Живой оригинал не трогаем.
    expect(alive?.replyQuote).toBe('живая цитата')
    expect(alive?.replyTo?.content).toBe('живой текст')
  })

  it('без курсора — новейшая страница по убыванию seq', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findMany.mockResolvedValue([])

    await service.getMessages(user('u1'), 'c1', { limit: 20 })

    const call = prisma.message.findMany.mock.calls[0][0]
    expect(call.where.seq).toBeUndefined()
    expect(call.orderBy).toEqual({ seq: 'desc' })
    // Курсора нет — и разрешать нечего: лишнего запроса быть не должно.
    expect(prisma.message.findFirst).not.toHaveBeenCalled()
  })
})

describe('ChatsService.setPinned — закрепление', () => {
  it('сообщение не найдено → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue(null)
    const err = await service.setPinned('u1', 'm1', true).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('не участник чата сообщения → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.setPinned('u1', 'm1', true).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('участник → закрепляет и эмитит message:pinned', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.update.mockResolvedValue({ id: 'm1', chatId: 'c1', pinnedAt: new Date() })
    // Закрепление пишет системное сообщение «закрепил сообщение».
    prisma.message.create.mockResolvedValue({ id: 'sys1', chatId: 'c1', createdAt: new Date() })
    await service.setPinned('u1', 'm1', true)
    expect(prisma.message.update.mock.calls[0][0].data.pinnedById).toBe('u1')
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:pinned', expect.anything())
  })

  it('снятие закрепления эмитит message:unpinned и обнуляет поля', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.update.mockResolvedValue({ id: 'm1', chatId: 'c1', pinnedAt: null })
    await service.setPinned('u1', 'm1', false)
    expect(prisma.message.update.mock.calls[0][0].data).toEqual({
      pinnedAt: null,
      pinnedById: null,
    })
    expect(realtime.emitToRoom).toHaveBeenCalledWith(
      'chat:c1',
      'message:unpinned',
      expect.anything(),
    )
  })
})

describe('ChatsService.searchMessages — область поиска', () => {
  it('chatId задан → проверяет членство и фильтрует по чату', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findMany.mockResolvedValue([])
    await service.searchMessages(user('u1'), { limit: 20, q: 'привет', chatId: 'c1' })
    const where = prisma.message.findMany.mock.calls[0][0].where
    expect(where.chatId).toBe('c1')
    expect(where.content).toEqual({ contains: 'привет', mode: 'insensitive' })
  })

  // F-F23: очищенное «у себя» не показывает лента — не должен находить и поиск. Страницы —
  // по seq внутри чата, а не составным курсором [createdAt, id].
  it('chatId задан → без очищенного у себя, страницы по seq', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-01-01T00:00:00Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null, clearedAt })
    prisma.message.findFirst.mockResolvedValue({ seq: 42 })
    prisma.message.findMany.mockResolvedValue([])

    await service.searchMessages(user('u1'), {
      limit: 20,
      q: 'привет',
      chatId: 'c1',
      cursor: 'm-last',
    })

    expect(prisma.message.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-last', chatId: 'c1' },
      select: { seq: true },
    })
    const args = prisma.message.findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({ chatId: 'c1', seq: { lt: 42 } })
    expect(args.where.AND).toEqual([{ createdAt: { gt: clearedAt } }])
    expect(args.orderBy).toEqual({ seq: 'desc' })
    expect(args.cursor).toBeUndefined()
  })

  it('без chatId → ограничивает чатами участника (без проверки конкретного членства)', async () => {
    const { service, prisma } = setup()
    prisma.message.findMany.mockResolvedValue([])
    await service.searchMessages(user('u1'), { limit: 20, q: 'тест' })
    expect(prisma.chatMember.findUnique).not.toHaveBeenCalled()
    const where = prisma.message.findMany.mock.calls[0][0].where
    expect(where.chat).toEqual({ members: { some: { userId: 'u1', bannedAt: null } } })
  })

  it('забаненный в группе не находит её сообщения глобальным поиском', async () => {
    const { service, prisma } = setup()
    // Строка членства у забаненного остаётся — отсечь её обязан фильтр bannedAt: null.
    const members = [
      { chatId: 'open', userId: 'u1', bannedAt: null },
      { chatId: 'banned', userId: 'u1', bannedAt: new Date() },
    ]
    const messages = [
      { id: 'm-open', chatId: 'open', content: 'тест в своём чате' },
      { id: 'm-banned', chatId: 'banned', content: 'тест после бана' },
    ]
    // Мини-исполнитель where: участник чата по строке членства с учётом всех полей фильтра.
    prisma.message.findMany.mockImplementation(
      async (args: { where: { chat: { members: { some: Record<string, unknown> } } } }) => {
        const cond = args.where.chat.members.some
        const allowed = new Set(
          members
            .filter((m) => Object.entries(cond).every(([k, v]) => m[k as keyof typeof m] === v))
            .map((m) => m.chatId),
        )
        return messages.filter((msg) => allowed.has(msg.chatId))
      },
    )
    const page = await service.searchMessages(user('u1'), { limit: 20, q: 'тест' })
    expect(page.items.map((m: { id: string }) => m.id)).toEqual(['m-open'])
  })

  // BUG-169: очищенное «у себя» и чат, удалённый у себя, глобальный поиск не находит.
  it('без chatId → не отдаёт очищенное у себя, курсор — по странице до фильтра', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-05-01T00:00:00Z')
    prisma.message.findMany.mockResolvedValue([
      { id: 'm-new', chatId: 'c1', content: 'тест', createdAt: new Date('2026-05-02T00:00:00Z') },
      { id: 'm-old', chatId: 'c1', content: 'тест', createdAt: new Date('2026-04-30T00:00:00Z') },
      { id: 'm-more', chatId: 'c2', content: 'тест', createdAt: new Date('2026-04-01T00:00:00Z') },
    ])
    prisma.chatMember.findMany.mockResolvedValue([{ chatId: 'c1', clearedAt, clearedRanges: null }])

    const page = await service.searchMessages(user('u1'), { limit: 2, q: 'тест' })

    expect(page.items.map((m: { id: string }) => m.id)).toEqual(['m-new'])
    expect(page.meta).toMatchObject({ cursor: 'm-old', hasNext: true })
  })

  it('забаненный в группе не ищет внутри неё → FORBIDDEN, выборки нет', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: new Date() })
    const err = await service
      .searchMessages(user('u1'), { limit: 20, q: 'тест', chatId: 'c1' })
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.findMany).not.toHaveBeenCalled()
  })
})

describe('ChatsService.getAttachmentUrl — доступ по членству', () => {
  it('файл не является вложением сообщения → NOT_FOUND', async () => {
    const { service, files } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: null })
    const err = await service.getAttachmentUrl('u1', 'f1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('не участник чата → WRONG_SCOPE, presigned не выдаётся', async () => {
    const { service, prisma, files, media } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: 'm1' })
    prisma.message.findUnique.mockResolvedValue({ chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.getAttachmentUrl('u1', 'f1').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
    expect(media.describeOne).not.toHaveBeenCalled()
  })

  // F-F23: водораздел clearedAt проверялся, а вырезанные «у себя» периоды — нет.
  it('вложение из вырезанного у себя периода → NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: 'm1' })
    prisma.message.findUnique.mockResolvedValue({
      chatId: 'c1',
      deletedAt: null,
      createdAt: new Date('2026-02-01T12:00:00Z'),
    })
    prisma.chatMember.findUnique.mockResolvedValue({
      id: 'mem1',
      bannedAt: null,
      clearedAt: null,
      clearedRanges: [{ from: '2026-02-01T00:00:00.000Z', to: '2026-02-02T00:00:00.000Z' }],
    })

    const err = await service.getAttachmentUrl('u1', 'f1').catch((e) => e)

    expect(err.code).toBe('NOT_FOUND')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('участник → выдаёт presigned URL', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: 'm1' })
    prisma.message.findUnique.mockResolvedValue({ chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    files.getPresignedUrl.mockResolvedValue('https://minio/url')
    const link = await service.getAttachmentUrl('u1', 'f1')
    expect(link.url).toBe('https://minio/url')
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now())
    expect(link.status).toBe('READY')
  })
})

describe('ChatsService.sendMessageRest — сообщение с вложениями', () => {
  it('пустой текст без файлов → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    const err = await service
      .sendMessageRest('u1', { chatId: 'c1', content: '' }, [])
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  // Сюда текст приходит уже нормализованным: обрезку и вырезание невидимых символов делает
  // схема на границе, а сервис проверяет только бизнес-правило «ни текста, ни файлов».
  // Раньше обрезка была и здесь, и в схеме — пара разъехалась, и по WS проходили пробелы.
  it('текст из одних пробелов схема приводит к пустому ещё до сервиса', () => {
    const parsed = MessageSendRestSchema.safeParse({ chatId: 'c1', content: '   ' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.content).toBe('')
  })

  it('файлы загружаются до сообщения и привязываются к нему в той же транзакции', async () => {
    const { service, prisma, realtime, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({ id: 'msg1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: '',
      sender: { lastName: 'B', firstName: 'A' },
      media: [{ id: 'f1' }],
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }])
    const res = await service.sendMessageRest('u1', { chatId: 'c1' }, [
      { buffer: Buffer.from('x') },
    ])
    expect(files.upload).toHaveBeenCalledTimes(1)
    // Сообщения на момент загрузки ещё нет — запись File создаётся непривязанной.
    expect(files.upload.mock.calls[0][0].messageId).toBeUndefined()
    expect(files.upload.mock.calls[0][0].bucket).toBe('chat-media')
    expect(files.upload.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.message.create.mock.invocationCallOrder[0] ?? 0,
    )
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] }, messageId: null },
      data: { messageId: 'msg1' },
    })
    expect(realtime.emitToRoom).toHaveBeenCalledTimes(1)
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', expect.anything())
    expect(res.id).toBe('msg1')
  })

  it('спойлер по номеру и «без сжатия» доезжают до привязанных файлов', async () => {
    const { service, prisma, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({ id: 'msg1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      sender: { lastName: 'B', firstName: 'A' },
    })
    files.upload.mockResolvedValueOnce({ id: 'f1' }).mockResolvedValueOnce({ id: 'f2' })

    await service.sendMessageRest('u1', { chatId: 'c1', spoilerIndexes: '1', asFiles: true }, [
      { buffer: Buffer.from('a') },
      { buffer: Buffer.from('b') },
    ])

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f2'] }, messageId: null },
      data: { messageId: 'msg1', asDocument: true },
    })
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f2'] } },
      data: { spoiler: true },
    })
  })

  // F-F04: раньше сообщение создавалось до файлов, и отказ второго вложения оставлял в чате
  // пустой пузырь с занятым seq — его видели все при следующей загрузке истории.
  it('отказ второго вложения не оставляет ни сообщения, ни уже загруженного файла', async () => {
    const { service, prisma, realtime, queue, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    files.upload
      .mockResolvedValueOnce({ id: 'f1' })
      .mockRejectedValueOnce(new AppException('FILE_TYPE_NOT_ALLOWED', 'нельзя'))

    const err = await service
      .sendMessageRest('u1', { chatId: 'c1' }, [
        { buffer: Buffer.from('a') },
        { buffer: Buffer.from('b') },
      ])
      .catch((e) => e)

    expect(err.code).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(prisma.$queryRaw).not.toHaveBeenCalled() // seq не выдан
    expect(files.delete).toHaveBeenCalledWith('f1')
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('файл исчез до привязки — транзакция откатывается, загруженное убирается', async () => {
    const { service, prisma, realtime, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({ id: 'msg1' })
    files.upload.mockResolvedValueOnce({ id: 'f1' }).mockResolvedValueOnce({ id: 'f2' })
    prisma.file.updateMany.mockResolvedValueOnce({ count: 1 })

    const err = await service
      .sendMessageRest('u1', { chatId: 'c1' }, [
        { buffer: Buffer.from('a') },
        { buffer: Buffer.from('b') },
      ])
      .catch((e) => e)

    expect(err.code).toBe('NOT_FOUND')
    expect(files.delete).toHaveBeenCalledWith('f1')
    expect(files.delete).toHaveBeenCalledWith('f2')
    expect(prisma.message.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })
})

describe('ChatsService.sendMessageFromUploads — сообщение по загруженным объектам', () => {
  it('отказ подтверждения второго объекта не оставляет сообщения-призрака', async () => {
    const { service, prisma, realtime, queue, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    files.confirmDirectUpload
      .mockResolvedValueOnce({ id: 'f1' })
      .mockRejectedValueOnce(new AppException('FILE_TOO_LARGE', 'много'))

    const err = await service
      .sendMessageFromUploads('u1', 'c1', {
        attachments: [{ key: 'u1/a.png' }, { key: 'u1/b.exe' }],
      })
      .catch((e) => e)

    expect(err.code).toBe('FILE_TOO_LARGE')
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(files.delete).toHaveBeenCalledWith('f1')
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('подтверждает без messageId и привязывает одной транзакцией', async () => {
    const { service, prisma, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({ id: 'msg1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      sender: { lastName: 'B', firstName: 'A' },
    })
    files.completeMultipart.mockResolvedValueOnce({ id: 'f-big' })

    await service.sendMessageFromUploads('u1', 'c1', {
      attachments: [
        { key: 'u1/a.png', spoiler: true },
        { key: 'u1/b.mp4', uploadId: 'up1', parts: [{ part: 1, etag: 'e1' }] },
      ],
    })

    expect(files.confirmDirectUpload.mock.calls[0][0].messageId).toBeUndefined()
    expect(files.completeMultipart.mock.calls[0][0].messageId).toBeUndefined()
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f-big'] }, messageId: null },
      data: { messageId: 'msg1' },
    })
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1'] } },
      data: { spoiler: true },
    })
  })
})

describe('ChatsService.toggleReaction (одна реакция на сообщение)', () => {
  it('нет реакции → создаёт и эмитит message:reaction', async () => {
    const { service, prisma, realtime } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.messageReaction.findMany.mockResolvedValue([])
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      reactions: [{ emoji: '👍', userId: 'u1' }],
    })
    await service.toggleReaction('u1', 'm1', '👍')
    expect(prisma.messageReaction.create).toHaveBeenCalledWith({
      data: { messageId: 'm1', userId: 'u1', emoji: '👍' },
    })
    expect(prisma.messageReaction.deleteMany).not.toHaveBeenCalled()
    expect(prisma.messageReaction.delete).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).toHaveBeenCalledWith(
      'chat:c1',
      'message:reaction',
      expect.anything(),
    )
  })

  it('та же эмодзи повторно → снимает (тоггл)', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.messageReaction.findMany.mockResolvedValue([{ id: 'r1', emoji: '👍' }])
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'm1', chatId: 'c1', reactions: [] })
    await service.toggleReaction('u1', 'm1', '👍')
    // deleteMany, а не delete: снятие, пришедшее дважды, не падает на исчезнувшей строке.
    expect(prisma.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1' } })
    expect(prisma.messageReaction.create).not.toHaveBeenCalled()
  })

  // F-F24: двойной клик — два запроса, оба видели «реакции нет», второй create падал на
  // уникальном ключе (500). Чтение и запись теперь под локом на (сообщение, участник).
  it('чтение и запись реакции — в транзакции под локом на пару «сообщение, участник»', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'm1', chatId: 'c1', reactions: [] })

    await service.toggleReaction('u1', 'm1', '👍')

    expect(prisma.$transaction).toHaveBeenCalled()
    const lockKeys = prisma.$executeRaw.mock.calls.map((c: unknown[]) => c[1])
    expect(lockKeys).toContain('chat-reaction:m1:u1')
    const lockAt = prisma.$executeRaw.mock.invocationCallOrder[0] ?? Infinity
    expect(lockAt).toBeLessThan(prisma.messageReaction.findMany.mock.invocationCallOrder[0] ?? 0)
  })

  it('другая эмодзи → заменяет прежнюю (deleteMany + create)', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.messageReaction.findMany.mockResolvedValue([{ id: 'r1', emoji: '👍' }])
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      reactions: [{ emoji: '❤️', userId: 'u1' }],
    })
    await service.toggleReaction('u1', 'm1', '❤️')
    expect(prisma.messageReaction.deleteMany).toHaveBeenCalledWith({
      where: { messageId: 'm1', userId: 'u1' },
    })
    expect(prisma.messageReaction.create).toHaveBeenCalledWith({
      data: { messageId: 'm1', userId: 'u1', emoji: '❤️' },
    })
  })

  // BUG-179: схема пропускала любую строку до 16 знаков — под сообщением появлялись слова.
  it('эмодзи не из набора реакций → BAD_REQUEST, но свою прежнюю снять можно', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.messageReaction.findMany.mockResolvedValueOnce([])
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'm1', chatId: 'c1', reactions: [] })

    const err = await service.toggleReaction('u1', 'm1', 'ДА').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.messageReaction.create).not.toHaveBeenCalled()

    prisma.messageReaction.findMany.mockResolvedValueOnce([{ id: 'r1', emoji: 'ДА' }])
    await service.toggleReaction('u1', 'm1', 'ДА')
    expect(prisma.messageReaction.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1' } })
  })

  it('не участник → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.toggleReaction('u1', 'm1', '👍').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
})

describe('ChatsService.forwardMessage', () => {
  it('требует членства в целевом и исходном чате; копирует вложения и эмитит message:new', async () => {
    const { service, prisma, realtime, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' }) // член обоих
    prisma.message.findFirst.mockResolvedValue({
      id: 'src',
      chatId: 'c0',
      content: 'hi',
      media: [{ bucket: 'chat-media', key: 'k1', mime: 'image/png', size: 10 }],
    })
    prisma.message.create.mockResolvedValue({ id: 'fwd1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({
      id: 'fwd1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'hi',
      forwardedFromId: 'src',
      sender: { lastName: 'B', firstName: 'A' },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }])
    const res = await service.forwardMessage(user('u1'), 'c1', 'src')
    expect(prisma.message.create.mock.calls[0][0].data.forwardedFromId).toBe('src')
    expect(files.copyToMessage).toHaveBeenCalledTimes(1)
    // Копия делается до сообщения и привязывается к нему в транзакции создания.
    expect(files.copyToMessage.mock.calls[0][2]).toBeUndefined()
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['copy-1'] }, messageId: null },
      data: { messageId: 'fwd1' },
    })
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', expect.anything())
    expect(res.id).toBe('fwd1')
  })

  it('сбой копирования вложения не оставляет пересылку без вложений', async () => {
    const { service, prisma, realtime, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findFirst.mockResolvedValue({
      id: 'src',
      chatId: 'c0',
      content: 'hi',
      linkPreview: null,
      media: [
        { bucket: 'chat-media', key: 'k1', mime: 'image/png', size: 10 },
        { bucket: 'chat-media', key: 'k2', mime: 'image/png', size: 10 },
      ],
    })
    files.copyToMessage
      .mockResolvedValueOnce({ id: 'copy-1' })
      .mockRejectedValueOnce(new Error('minio down'))

    await expect(service.forwardMessage(user('u1'), 'c1', 'src')).rejects.toThrow('minio down')

    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(files.delete).toHaveBeenCalledWith('copy-1')
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })

  // BUG-173: пересылка поста приходила пустым пузырём, опрос и спойлер терялись.
  it('переносит карточку поста, опрос и спойлер вложения', async () => {
    const { service, prisma, files, posts } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findFirst.mockResolvedValue({
      id: 'src',
      chatId: 'c0',
      content: '',
      linkPreview: null,
      sharedPostId: 'post-1',
      poll: {
        question: 'Когда?',
        multiple: true,
        anonymous: false,
        allowRevote: true,
        randomOrder: false,
        options: [
          { text: 'Утром', order: 0 },
          { text: 'Вечером', order: 1 },
        ],
      },
      media: [{ bucket: 'chat-media', key: 'k1', mime: 'image/png', size: 10, spoiler: true }],
    })
    files.copyToMessage.mockResolvedValueOnce({ id: 'copy-1' })
    prisma.message.create.mockResolvedValue({ id: 'fwd1' })
    prisma.message.findUniqueOrThrow.mockResolvedValue({ id: 'fwd1', chatId: 'c1' })
    prisma.chat.update.mockResolvedValue({})

    await service.forwardMessage(user('u1'), 'c1', 'src')

    expect(posts.assertVisibleToViewer).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'u1' }),
      'post-1',
    )
    const data = prisma.message.create.mock.calls[0][0].data
    expect(data.sharedPostId).toBe('post-1')
    expect(data.poll.create).toMatchObject({
      question: 'Когда?',
      multiple: true,
      options: {
        create: [
          { text: 'Утром', order: 0 },
          { text: 'Вечером', order: 1 },
        ],
      },
    })
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['copy-1'] } },
      data: { spoiler: true },
    })
  })

  it('исходное сообщение не найдено → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findFirst.mockResolvedValue(null)
    const err = await service.forwardMessage(user('u1'), 'c1', 'src').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('ChatsService.setMuted / notifyNewMessage', () => {
  it("mute='forever' проставляет mutedAt", async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })
    const res = await service.setMuted('u1', 'c1', 'forever')
    expect(prisma.chatMember.updateMany.mock.calls[0][0].data.mutedAt).toBeInstanceOf(Date)
    expect(res).toEqual({ chatId: 'c1', muted: true, importantOnly: false })
  })

  it('mute с importantOnly сохраняет режим «только важные»', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })

    const res = await service.setMuted('u1', 'c1', 'forever', true)

    expect(prisma.chatMember.updateMany.mock.calls[0][0].data.muteImportantOnly).toBe(true)
    expect(res).toEqual({ chatId: 'c1', muted: true, importantOnly: true })
  })

  it('снятие заглушения сбрасывает режим: он описывает исключение из mute, а не отдельную настройку', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })

    const res = await service.setMuted('u1', 'c1', null, true)

    expect(prisma.chatMember.updateMany.mock.calls[0][0].data.muteImportantOnly).toBe(false)
    expect(res).toEqual({ chatId: 'c1', muted: false, importantOnly: false })
  })

  it('«только важные»: упоминание по имени пробивает заглушение', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: '@Сериков Асхат посмотри, пожалуйста',
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([
      { userId: 'u2', mutedAt: new Date(), mutedUntil: null, muteImportantOnly: true },
    ])
    // Композер вставляет «@Фамилия Имя» — по этой строке и ищем.
    prisma.user.findMany.mockResolvedValue([{ id: 'u2', firstName: 'Асхат', lastName: 'Сериков' }])

    await service.createMessage('u1', { chatId: 'c1', content: '@Сериков Асхат посмотри' })

    expect(queue.enqueue).toHaveBeenCalled()
    expect(queue.enqueue.mock.calls[0][2].recipientIds).toEqual(['u2'])
  })

  it('«только важные»: ответ на моё сообщение пробивает заглушение без разбора текста', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findFirst.mockResolvedValue({ id: 'm0' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'да, согласен',
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
      replyTo: { id: 'm0', senderId: 'u2', content: 'вопрос', sender: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([
      { userId: 'u2', mutedAt: new Date(), mutedUntil: null, muteImportantOnly: true },
    ])

    await service.createMessage('u1', { chatId: 'c1', content: 'да, согласен', replyToId: 'm0' })

    expect(queue.enqueue).toHaveBeenCalled()
    // Имена не запрашивали: «@» в тексте нет, а ответ и так важный.
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('«только важные»: обычное сообщение по-прежнему без уведомления', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'всем привет',
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([
      { userId: 'u2', mutedAt: new Date(), mutedUntil: null, muteImportantOnly: true },
    ])

    await service.createMessage('u1', { chatId: 'c1', content: 'всем привет' })

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('заглушённому: сообщение доставляется (chat:activity), но уведомление не шлётся', async () => {
    const { service, prisma, queue, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'hi',
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2', mutedAt: new Date() }])
    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })
    // Живой список — сигнал приходит даже заглушённому.
    expect(realtime.emitToUser).toHaveBeenCalledWith('u2', 'chat:activity', { chatId: 'c1' })
    // Но уведомление (job в очереди) заглушённому не ставится.
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('незаглушённому: и chat:activity, и уведомление в очереди', async () => {
    const { service, prisma, queue, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'hi',
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2', mutedAt: null }])
    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u2', 'chat:activity', { chatId: 'c1' })
    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('отправителю: chat:activity (его список и другие устройства) и отметка прочтения на своём сообщении', async () => {
    const { service, prisma, realtime } = setup()
    const sentAt = new Date('2026-10-17T01:24:00Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({
      id: 'msg1',
      chatId: 'c1',
      senderId: 'u1',
      content: 'Имя\nhttps://example/profile/u9',
      createdAt: sentAt,
      sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2', mutedAt: null }])
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: sentAt })
    await service.createMessage('u1', { chatId: 'c1', content: 'Имя\nhttps://example/profile/u9' })
    // Список отправителя обновляется: раньше сигнал уходил всем, кроме него, и превью
    // оставалось прежним, пока не перезагрузишь страницу.
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'c1' })
    // Отправка — прочтение: отметка встаёт на своё сообщение, только вперёд.
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: {
        chatId: 'c1',
        userId: 'u1',
        OR: [{ lastReadAt: null }, { lastReadAt: { lt: sentAt } }],
      },
      data: { lastReadAt: sentAt },
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:read', {
      chatId: 'c1',
      readAt: sentAt,
    })
  })
})

describe('ChatsService.getPresence', () => {
  const me = { ...user('u1'), universityId: 'uni1' }

  it('возвращает онлайн-статус участников по realtime.onlineAmong', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    prisma.user.findMany.mockResolvedValueOnce([{ id: 'u2', universityId: 'uni1' }])
    realtime.onlineAmong.mockImplementation((ids: string[]) => ids.filter((id) => id === 'u2'))
    const res = await service.getPresence(me, 'c1')
    expect(res).toEqual([
      { userId: 'u1', online: false },
      { userId: 'u2', online: true },
    ])
  })

  // BUG-056: общий (старый личный) чат права на статус не даёт — §3.7: свой вуз, друзья,
  // платформенные роли; блокировка скрывает статус в любую сторону.
  it('чужой вуз без дружбы и заблокированный — «не в сети»', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'other-uni' },
      { userId: 'blocked' },
      { userId: 'friend' },
    ])
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'other-uni', universityId: 'uni2' },
      { id: 'blocked', universityId: 'uni1' },
      { id: 'friend', universityId: 'uni2' },
    ])
    prisma.userBlock.findMany.mockResolvedValueOnce([{ blockerId: 'blocked', blockedId: 'u1' }])
    prisma.friendship.findMany.mockResolvedValueOnce([{ requesterId: 'friend', addresseeId: 'u1' }])
    realtime.onlineAmong.mockImplementation((ids: string[]) => ids)

    const res = await service.getPresence(me, 'c1')

    expect(res).toEqual([
      { userId: 'u1', online: true },
      { userId: 'other-uni', online: false },
      { userId: 'blocked', online: false },
      { userId: 'friend', online: true },
    ])
  })
})

// F-F12: присутствие уходит не всему вузу, а тем, кто человека видит.
describe('ChatsService.presenceRooms — кому сообщать о присутствии', () => {
  it('собеседникам личных чатов — в их личные комнаты, остальным чатам — в комнату чата', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany
      .mockResolvedValueOnce([
        { chatId: 'p1', chat: { type: 'PRIVATE' } },
        { chatId: 'g1', chat: { type: 'GROUP' } },
        { chatId: 'p2', chat: { type: 'PRIVATE' } },
        { chatId: 'f1', chat: { type: 'FACULTY' } },
      ])
      .mockResolvedValueOnce([
        { userId: 'u2', user: { role: Role.STUDENT, universityId: 'uni1' } },
        { userId: 'u3', user: { role: Role.STUDENT, universityId: 'uni1' } },
      ])
    prisma.user.findUnique.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u2', universityId: 'uni1' },
      { id: 'u3', universityId: 'uni1' },
    ])

    await expect(service.presenceRooms('u1')).resolves.toEqual([
      'chat:g1',
      'chat:f1',
      'user:u2',
      'user:u3',
    ])
    // Забаненного в группе её открытым окнам не показываем.
    expect(prisma.chatMember.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: 'u1', bannedAt: null },
      take: expect.any(Number),
    })
    expect(prisma.chatMember.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { chatId: { in: ['p1', 'p2'] }, userId: { not: 'u1' } },
      take: 2,
    })
  })

  // BUG-056: личный чат остаётся и после конца дружбы и после блокировки — собеседнику,
  // которому статус не положен по §3.7, переходы не шлём.
  it('собеседнику из чужого вуза без дружбы и заблокированному статус не уходит', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany
      .mockResolvedValueOnce([
        { chatId: 'p1', chat: { type: 'PRIVATE' } },
        { chatId: 'p2', chat: { type: 'PRIVATE' } },
        { chatId: 'p3', chat: { type: 'PRIVATE' } },
      ])
      .mockResolvedValueOnce([
        { userId: 'ex-friend', user: { role: Role.STUDENT, universityId: 'uni2' } },
        { userId: 'blocker', user: { role: Role.STUDENT, universityId: 'uni1' } },
        { userId: 'staff', user: { role: Role.PLATFORM_ADMIN, universityId: null } },
      ])
    prisma.user.findUnique.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'ex-friend', universityId: 'uni2' },
      { id: 'blocker', universityId: 'uni1' },
      { id: 'staff', universityId: null },
    ])
    prisma.userBlock.findMany.mockResolvedValueOnce([{ blockerId: 'blocker', blockedId: 'u1' }])

    await expect(service.presenceRooms('u1')).resolves.toEqual(['user:staff'])
  })

  it('без личных чатов собеседников не ищет', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValueOnce([{ chatId: 'g1', chat: { type: 'GROUP' } }])

    await expect(service.presenceRooms('u1')).resolves.toEqual(['chat:g1'])
    expect(prisma.chatMember.findMany).toHaveBeenCalledTimes(1)
  })

  it('регистрируется в шлюзе как аудитория присутствия', async () => {
    const { service, realtime, prisma } = setup()
    const setPresenceAudience = jest.fn()
    Object.assign(realtime, { setPresenceAudience })
    prisma.chatMember.findMany.mockResolvedValueOnce([])

    service.onModuleInit()

    const audience = setPresenceAudience.mock.calls[0]?.[0] as (id: string) => Promise<string[]>
    await expect(audience('u1')).resolves.toEqual([])
  })
})

// F-F02: превью списка — по одной строке на чат, а не всей историей чатов страницы.
describe('ChatsService.listChats — последнее сообщение', () => {
  const at = new Date('2026-10-01T10:00:00Z')
  const chatRow = (id: string) => ({
    id,
    type: 'GROUP',
    title: id,
    description: null,
    avatarUrl: null,
    createdById: null,
    groupId: null,
    facultyId: null,
    universityId: null,
    subject: null,
    requestPendingForId: null,
    updatedAt: at,
    members: [
      {
        lastReadAt: null,
        mutedAt: null,
        mutedUntil: null,
        muteImportantOnly: false,
        isAdmin: false,
        clearedAt: null,
        draft: null,
        pinnedAt: null,
        archivedAt: null,
      },
    ],
    _count: { members: 3 },
  })

  it('берёт его отдельным запросом и считает по нему непрочитанное', async () => {
    const { service, prisma } = setup()
    prisma.chat.findMany.mockResolvedValue([chatRow('c1'), chatRow('c2')])
    prisma.$queryRaw.mockResolvedValue([{ chatId: 'c1', id: 'm1' }])
    prisma.message.findMany.mockResolvedValue([
      { id: 'm1', chatId: 'c1', senderId: 'u2', content: 'привет', createdAt: at },
    ])
    const messageGroupBy = jest.fn().mockResolvedValue([{ chatId: 'c1', _count: { _all: 2 } }])
    Object.assign(prisma.message, { groupBy: messageGroupBy })
    Object.assign(prisma.chatMember, { groupBy: jest.fn().mockResolvedValue([]) })

    // С курсором: провижининг официальных чатов идёт только на первой странице.
    const page = await service.listChats(user('u1'), { limit: 20, cursor: 'c0' })

    expect(prisma.chat.findMany.mock.calls[0]?.[0].select).not.toHaveProperty('messages')
    const sql = (prisma.$queryRaw.mock.calls[0]?.[0] as string[]).join('?')
    expect(sql).toMatch(/LATERAL[\s\S]*LIMIT 1/)
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['m1'] } }, take: 1 }),
    )
    // Непрочитанное считается только там, где последнее сообщение есть.
    expect(messageGroupBy.mock.calls[0]?.[0].where.OR).toEqual([{ chatId: 'c1' }])
    expect(page.items).toEqual([
      expect.objectContaining({ id: 'c1', lastMessage: expect.objectContaining({ id: 'm1' }) }),
      expect.objectContaining({ id: 'c2', lastMessage: null, unreadCount: 0 }),
    ])
    expect(page.items[0]).toMatchObject({ unreadCount: 2, unread: true })
  })
})

// BUG-175: курсор Prisma по id брал updatedAt чата-курсора на момент следующего запроса —
// сообщение в нём уводило чат наверх, и вторая страница начиналась с начала списка.
describe('ChatsService.listChats — курсор', () => {
  it('курсор — граница (updatedAt, id), а не ссылка на строку', async () => {
    const { service, prisma } = setup()
    const updatedAt = new Date('2026-10-01T12:00:00.000Z')
    const row = { id: 'c9', updatedAt, members: [], _count: { members: 2 } }
    prisma.chat.findMany.mockResolvedValueOnce([row, { ...row, id: 'c8' }])
    prisma.$queryRaw.mockResolvedValue([])
    Object.assign(prisma.chatMember, { groupBy: jest.fn().mockResolvedValue([]) })
    Object.assign(prisma.message, { groupBy: jest.fn().mockResolvedValue([]) })

    const page = await service.listChats(user('u1'), {
      limit: 1,
      cursor: `${updatedAt.getTime()}_c10`,
    })

    const args = prisma.chat.findMany.mock.calls[0]?.[0]
    expect(args.cursor).toBeUndefined()
    expect(args.where.OR).toEqual([
      { updatedAt: { lt: updatedAt } },
      { updatedAt, id: { lt: 'c10' } },
    ])
    expect(page.meta).toMatchObject({ cursor: `${updatedAt.getTime()}_c9`, hasNext: true })
  })
})

describe('ChatsService.deleteOrLeaveChat', () => {
  const actor = (sub: string) => ({ sub }) as Parameters<ChatsService['deleteOrLeaveChat']>[0]

  it('PRIVATE: прячет чат у себя (hiddenAt + clearedAt), не удаляя членство', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValue({ id: 'c1', type: 'PRIVATE', createdById: 'u2' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    const res = await service.deleteOrLeaveChat(actor('u1'), 'c1')
    const args = prisma.chatMember.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({ chatId: 'c1', userId: 'u1' })
    expect(args.data.hiddenAt).toBeInstanceOf(Date)
    expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
    expect(res).toEqual({ chatId: 'c1', deleted: false })
  })

  it('членство проверяет одним чтением по ключу, а не всем составом чата', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValue({ id: 'c1', type: 'GROUP', createdById: 'u2' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.deleteOrLeaveChat(actor('u1'), 'c1').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.chat.findUnique.mock.calls[0]?.[0].select).not.toHaveProperty('members')
    expect(prisma.chatMember.findUnique).toHaveBeenCalledWith({
      where: { chatId_userId: { chatId: 'c1', userId: 'u1' } },
      select: { id: true, bannedAt: true },
    })
  })

  // BUG-162: выход забаненного стирал строку с баном, и ссылка-приглашение пускала его обратно.
  it('забаненный не выходит из группы — строка с баном остаётся', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValue({ id: 'c1', type: 'GROUP', createdById: 'u2' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1', bannedAt: new Date() })
    const err = await service.deleteOrLeaveChat(actor('u1'), 'c1').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
  })

  // F-F17: официальный чат вернулся бы сам через ensureOfficialChat, «Сохранённые»
  // последним участником стирались вместе с заметками.
  it.each(['FACULTY', 'GROUP_OFFICIAL', 'SUBJECT', 'DEAN', 'SUPPORT', 'SAVED', 'SUPPORT_PLATFORM'])(
    '%s: «удалить» только скрывает у себя — членство и переписка целы',
    async (type) => {
      const { service, prisma, realtime } = setup()
      prisma.chat.findUnique.mockResolvedValue({ id: 'c1', type, createdById: null })
      prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
      const res = await service.deleteOrLeaveChat(actor('u1'), 'c1')
      expect(res).toEqual({ chatId: 'c1', deleted: false })
      expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
        where: { chatId: 'c1', userId: 'u1' },
        data: { hiddenAt: expect.any(Date) },
      })
      expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
      expect(prisma.chat.delete).not.toHaveBeenCalled()
      // Другие устройства того же человека убирают чат из списка сразу.
      expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'c1' })
    },
  )

  it('владелец удаляет группу: каждый участник получает сигнал и уходит из комнаты', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findUnique.mockResolvedValue({ id: 'g1', type: 'GROUP', createdById: 'u1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.findMany.mockResolvedValueOnce([
      { id: 'a', userId: 'u1' },
      { id: 'b', userId: 'u2' },
      { id: 'c', userId: 'u3' },
    ])
    const res = await service.deleteOrLeaveChat(actor('u1'), 'g1')
    expect(res).toEqual({ chatId: 'g1', deleted: true })
    // Состав читается до каскадного удаления — после него его уже не узнать.
    expect(prisma.chatMember.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.chat.delete.mock.invocationCallOrder[0]!,
    )
    expect(prisma.chat.delete).toHaveBeenCalledWith({ where: { id: 'g1' } })
    for (const id of ['u1', 'u2', 'u3']) {
      expect(realtime.leaveRoom).toHaveBeenCalledWith(id, 'chat:g1')
      expect(realtime.emitToUser).toHaveBeenCalledWith(id, 'chat:activity', { chatId: 'g1' })
    }
  })

  it('участник выходит из группы: членство снимается, его устройства узнают сразу', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findUnique.mockResolvedValue({ id: 'g1', type: 'GROUP', createdById: 'u2' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    Object.assign(prisma.chatMember, { count: jest.fn().mockResolvedValue(2) })
    prisma.message.create.mockResolvedValue({ id: 'sys', createdAt: new Date() })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: new Date() })
    const res = await service.deleteOrLeaveChat(actor('u1'), 'g1')
    expect(res).toEqual({ chatId: 'g1', deleted: false })
    expect(prisma.chatMember.deleteMany).toHaveBeenCalledWith({
      where: { chatId: 'g1', userId: 'u1' },
    })
    expect(realtime.leaveRoom).toHaveBeenCalledWith('u1', 'chat:g1')
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'g1' })
  })
})

// F-F14: бейдж без заглушённых и без вырезанных «у себя» периодов.
describe('ChatsService.getUnreadSummary', () => {
  const member = (chatId: string, over: Record<string, unknown> = {}) => ({
    chatId,
    lastReadAt: null,
    mutedAt: null,
    mutedUntil: null,
    clearedAt: null,
    clearedRanges: null,
    chat: { requestPendingForId: null },
    ...over,
  })

  function withGroupBy(prisma: ReturnType<typeof setup>['prisma'], rows: unknown[]) {
    const groupBy = jest.fn().mockResolvedValue(rows)
    Object.assign(prisma.message, { groupBy })
    return groupBy
  }

  it('заглушённые чаты в бейдж не идут — их число отдельно', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue([
      member('loud'),
      member('forever', { mutedAt: new Date() }),
      member('until', { mutedUntil: new Date(Date.now() + 60_000) }),
      member('expired', { mutedUntil: new Date(Date.now() - 60_000) }),
    ])
    withGroupBy(prisma, [
      { chatId: 'loud', _count: { _all: 2 } },
      { chatId: 'forever', _count: { _all: 40 } },
      { chatId: 'until', _count: { _all: 5 } },
      { chatId: 'expired', _count: { _all: 1 } },
    ])

    await expect(service.getUnreadSummary(user('u1'))).resolves.toEqual({
      chats: 2,
      messages: 3,
      muted: { chats: 2, messages: 45 },
    })
  })

  it('вырезанные «у себя» периоды из счётчика исключаются', async () => {
    const { service, prisma } = setup()
    const readAt = new Date('2026-10-01T00:00:00.000Z')
    prisma.chatMember.findMany.mockResolvedValue([
      member('c1', {
        lastReadAt: readAt,
        clearedRanges: [{ from: '2026-10-02T00:00:00.000Z', to: '2026-10-03T23:59:59.999Z' }],
      }),
    ])
    const groupBy = withGroupBy(prisma, [])

    await service.getUnreadSummary(user('u1'))

    expect(groupBy.mock.calls[0]?.[0].where.OR).toEqual([
      {
        chatId: 'c1',
        AND: [
          { createdAt: { gt: readAt } },
          {
            NOT: {
              createdAt: {
                gte: new Date('2026-10-02T00:00:00.000Z'),
                lte: new Date('2026-10-03T23:59:59.999Z'),
              },
            },
          },
        ],
      },
    ])
  })

  it('без чатов для подсчёта в базу за сообщениями не ходит', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue([
      member('req', { chat: { requestPendingForId: 'u1' } }),
    ])
    const groupBy = withGroupBy(prisma, [])
    await expect(service.getUnreadSummary(user('u1'))).resolves.toEqual({
      chats: 0,
      messages: 0,
      muted: { chats: 0, messages: 0 },
    })
    expect(groupBy).not.toHaveBeenCalled()
  })
})

describe('ChatsService.exportMessages', () => {
  // F-F23: выгружались ПЕРВЫЕ пять тысяч — в длинном чате файл обрывался на начале истории.
  it('участник → последние сообщения, в файле хронологически, с cap', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    // Выборка идёт от новых к старым — в выгрузке порядок обратный.
    prisma.message.findMany.mockResolvedValue([{ id: 'b' }, { id: 'a' }])
    const res = await service.exportMessages('u1', 'c1')
    expect(res.map((m: { id: string }) => m.id)).toEqual(['a', 'b'])
    const args = prisma.message.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ seq: 'desc' })
    // На одну больше потолка — так видно, что история длиннее выгрузки.
    expect(args.take).toBe(5001)
  })

  it('очищенное «у себя» в выгрузку не попадает', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-01-01T00:00:00Z')
    const range = { from: '2026-02-01T00:00:00.000Z', to: '2026-02-02T00:00:00.000Z' }
    prisma.chatMember.findUnique.mockResolvedValue({
      id: 'mem1',
      clearedAt,
      clearedRanges: [range],
    })
    prisma.message.findMany.mockResolvedValue([])

    await service.exportMessages('u1', 'c1')

    const where = prisma.message.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ chatId: 'c1', deletedAt: null })
    expect(where.AND).toEqual([
      { createdAt: { gt: clearedAt } },
      { NOT: { createdAt: { gte: new Date(range.from), lte: new Date(range.to) } } },
    ])
  })

  it('история длиннее потолка — в шапке файла пометка, в JSON — truncated', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      id: `m${5001 - i}`,
      content: 'x',
      media: [],
      createdAt: new Date('2026-03-01T10:00:00Z'),
      sender: { firstName: 'Иван', lastName: 'Иванов' },
    }))
    prisma.message.findMany.mockResolvedValue(rows)
    const options = {
      context: {
        kind: 'chat' as const,
        actor: { id: 'u1', fullName: 'Иван Иванов' },
        locale: 'ru' as const,
        timezone: 'Asia/Almaty',
        generatedAt: new Date(),
      },
      info: [['Система', 'StudentHub']] as Array<[string, string]>,
      provenance: { system: 'StudentHub' },
    }

    const txt = await service.exportFile('u1', 'c1', { ...options, format: 'txt' })
    expect(txt.split('\n')[1]).toBe(
      'Выгружены последние 5000 сообщений — более ранние в файл не вошли',
    )
    expect(txt.split('\n').filter((line) => line.startsWith('['))).toHaveLength(5000)

    const json = JSON.parse(await service.exportFile('u1', 'c1', { ...options, format: 'json' }))
    expect(json.truncated).toBe(true)
    expect(json.messages).toHaveLength(5000)
    // Самое старое из выборки — лишнее, по нему и видно усечение; в файле его нет.
    expect(json.messages[0].id).toBe('m2')
  })
})

describe('ChatsService — официальные чаты (9.6)', () => {
  const fullScopeUser = (): JwtPayload => ({
    sub: 'stu1',
    role: Role.STUDENT,
    universityId: 'uni1',
    facultyId: 'fac1',
    groupId: 'grp1',
  })

  it('создаёт GROUP_OFFICIAL, FACULTY, DEAN, SUPPORT и SUBJECT-чаты своего scope', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    // Активное расписание группы содержит один предмет.
    prisma.pair.findMany.mockResolvedValueOnce([{ groupId: 'grp1', subject: 'Математика' }])

    await service.ensureOfficialChatsForUser(fullScopeUser())

    const createdTypes = prisma.chat.create.mock.calls.map((c) => c[0].data.type)
    expect(createdTypes).toEqual(
      expect.arrayContaining(['GROUP_OFFICIAL', 'FACULTY', 'DEAN', 'SUPPORT', 'SUBJECT']),
    )
    // SUBJECT-чат хранит предмет и группу.
    const subjectCreate = prisma.chat.create.mock.calls.find((c) => c[0].data.type === 'SUBJECT')
    expect(subjectCreate?.[0].data).toMatchObject({ groupId: 'grp1', subject: 'Математика' })
  })

  it('преподаватель без группы получает SUBJECT-чаты по своим парам', async () => {
    const { service, prisma } = setup()
    const teacher: JwtPayload = {
      sub: 'tch1',
      role: Role.TEACHER,
      universityId: 'uni1',
      facultyId: 'fac1',
      groupId: null,
    }
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    // Первый findMany (по группе) не вызывается — groupId null; второй (по teacherId) вернёт пару.
    prisma.pair.findMany.mockResolvedValue([{ groupId: 'grpX', subject: 'Физика' }])

    await service.ensureOfficialChatsForUser(teacher)

    const subjectCreate = prisma.chat.create.mock.calls.find((c) => c[0].data.type === 'SUBJECT')
    expect(subjectCreate?.[0].data).toMatchObject({ groupId: 'grpX', subject: 'Физика' })
    // teacher без groupId → пары ищем только по teacherId (один запрос к pair).
    expect(prisma.pair.findMany).toHaveBeenCalledTimes(1)
  })

  // Раньше «Сохранённые» заводились только в GET /chats/saved — то есть в момент, когда
  // человек нажимал пункт меню. До этого в списке чатов их не было.
  it('«Сохранённые» создаются вместе с остальными авточатами', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    prisma.pair.findMany.mockResolvedValue([])

    await service.ensureOfficialChatsForUser(fullScopeUser())

    const saved = prisma.chat.create.mock.calls.find((c) => c[0].data.type === 'SAVED')
    expect(saved?.[0].data).toMatchObject({ createdById: 'stu1' })
  })

  // Платформенным ролям не достаётся ни одного чата по scope — он у них пустой.
  // «Сохранённые» единственные, и условий у них быть не должно.
  it('роль без вуза, факультета и группы всё равно получает «Сохранённые»', async () => {
    const { service, prisma } = setup()
    const admin: JwtPayload = {
      sub: 'adm1',
      role: Role.PLATFORM_ADMIN,
      universityId: null,
      facultyId: null,
      groupId: null,
    }
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    prisma.pair.findMany.mockResolvedValue([])

    await service.ensureOfficialChatsForUser(admin)

    const createdTypes = prisma.chat.create.mock.calls.map((c) => c[0].data.type)
    expect(createdTypes).toEqual(['SAVED'])
  })

  // Набор задан таблицей AUTO_CHATS_BY_ROLE, а не выводится из scope: у декана тот же
  // facultyId, что у преподавателя, но предметы он не ведёт и в их чаты не входит.
  it('декану не заводятся чаты предметов, хотя scope тот же', async () => {
    const { service, prisma } = setup()
    const dean: JwtPayload = {
      sub: 'dean1',
      role: Role.DEAN,
      universityId: 'uni1',
      facultyId: 'fac1',
      groupId: null,
    }
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })

    await service.ensureOfficialChatsForUser(dean)

    const createdTypes = prisma.chat.create.mock.calls.map((c) => c[0].data.type)
    expect(createdTypes).toEqual(['SAVED', 'FACULTY', 'DEAN', 'SUPPORT'])
    // За парами не ходим вовсе — таблица предметов декану не даёт.
    expect(prisma.pair.findMany).not.toHaveBeenCalled()
  })

  it('администрации вуза — только «Сохранённые» и комната поддержки', async () => {
    const { service, prisma } = setup()
    const admin: JwtPayload = {
      sub: 'ua1',
      role: Role.UNIVERSITY_ADMIN,
      universityId: 'uni1',
      facultyId: 'fac1',
      groupId: null,
    }
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })

    await service.ensureOfficialChatsForUser(admin)

    // facultyId есть, но факультетские чаты администрации вуза не положены.
    expect(prisma.chat.create.mock.calls.map((c) => c[0].data.type)).toEqual(['SAVED', 'SUPPORT'])
  })

  // Студент предметы ведёт не он — второй запрос по teacherId раньше уходил всегда и
  // заведомо возвращал пусто.
  it('студенту за парами ходим один раз — по своей группе', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockImplementation(({ data }: { data: { type: string } }) =>
      Promise.resolve({ id: `chat-${data.type}` }),
    )
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    prisma.pair.findMany.mockResolvedValue([{ groupId: 'grp1', subject: 'Математика' }])

    await service.ensureOfficialChatsForUser(fullScopeUser())

    expect(prisma.pair.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.pair.findMany.mock.calls[0][0].where).toMatchObject({ groupId: 'grp1' })
  })

  it('существующие «Сохранённые» второй раз не создаются', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'saved-1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm' })
    prisma.pair.findMany.mockResolvedValue([])

    await service.ensureOfficialChatsForUser(fullScopeUser())

    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  // F-F05: группа открывает «Чаты» в одну минуту, два запроса видят «чата нет». Создание
  // идёт под локом по ключу будущего чата, и повторный поиск под ним находит чат первого.
  it('гонка создания: под локом находится чат параллельного запроса, второй не создаётся', async () => {
    const { service, prisma } = setup()
    const groupOnly: JwtPayload = { ...fullScopeUser(), facultyId: null, universityId: null }
    // «Сохранённые» находятся сразу; чата группы до лока нет, под локом — уже есть.
    prisma.chat.findFirst
      .mockResolvedValueOnce({ id: 'saved-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'off-winner' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })

    await service.ensureOfficialChatsForUser(groupOnly)

    expect(prisma.chat.create).not.toHaveBeenCalled()
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('chat-create:GROUP_OFFICIAL:::grp1:')
    // Пользователь добавлен в чат победителя.
    expect(prisma.chatMember.create).toHaveBeenCalledWith({
      data: { chatId: 'off-winner', userId: 'stu1', lastReadAt: expect.any(Date) },
    })
    // Поиск — самый ранний: дубли, накопившиеся до лока, остаются в данных.
    expect(prisma.chat.findFirst.mock.calls[2][0]).toMatchObject({
      where: { type: 'GROUP_OFFICIAL', groupId: 'grp1' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  })

  it('лок берётся до создания, и только когда чата нет', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.chat.create.mockResolvedValue({ id: 'saved-new' })

    await expect(service.getSavedChat('u1')).resolves.toEqual({ id: 'saved-new' })
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('chat-create:SAVED:u1')
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.chat.create.mock.invocationCallOrder[0] ?? 0,
    )

    // Чат уже есть — ни транзакции, ни лока: ensure ищет так на каждый тип и предмет.
    prisma.$transaction.mockClear()
    prisma.chat.findFirst.mockResolvedValue({ id: 'saved-new' })
    await service.getSavedChat('u1')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('ключ лока чата предмета включает группу и предмет', async () => {
    const { service, prisma } = setup()
    const teacher: JwtPayload = {
      sub: 'tch1',
      role: Role.TEACHER,
      universityId: null,
      facultyId: null,
      groupId: null,
    }
    prisma.chat.findFirst.mockResolvedValueOnce({ id: 'saved-1' }).mockResolvedValue(null)
    prisma.chat.create.mockResolvedValue({ id: 'subj-1' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    prisma.chatMember.create.mockResolvedValue({ id: 'm' })
    prisma.pair.findMany.mockResolvedValue([{ groupId: 'grpX', subject: 'Физика' }])

    await service.ensureOfficialChatsForUser(teacher)

    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('chat-create:SUBJECT:::grpX:Физика')
  })
})

describe('ChatsService — общие материалы (§23)', () => {
  it('listChatMedia: не участник → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service
      .listChatMedia(user('u1'), 'c1', { limit: 20, type: 'media' })
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('listChatMedia type=media: MIME image/video, страница + hasNext', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.file.findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: `f${i}`,
        name: `p${i}.jpg`,
        mime: 'image/jpeg',
        size: 100,
        posterKey: null,
        createdAt: new Date(),
        messageId: `msg${i}`,
        message: { createdAt: new Date(), senderId: 'u2', sender: { id: 'u2' } },
      })),
    )
    const res = await service.listChatMedia(user('u1'), 'c1', { limit: 20, type: 'media' })
    expect(res.items).toHaveLength(20)
    expect(res.meta.hasNext).toBe(true)
    expect(res.items[0]).toMatchObject({ id: 'f0', messageId: 'msg0', hasPoster: false })
    const where = prisma.file.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { mime: { startsWith: 'image/' } },
      { mime: { startsWith: 'video/' } },
    ])
  })

  it('listChatMedia type=file: MIME NOT image/video/audio', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    await service.listChatMedia(user('u1'), 'c1', { limit: 20, type: 'file' })
    const where = prisma.file.findMany.mock.calls[0][0].where
    expect(where.NOT).toEqual([
      { mime: { startsWith: 'image/' } },
      { mime: { startsWith: 'video/' } },
      { mime: { startsWith: 'audio/' } },
    ])
  })

  it('listChatLinks: только linkPreview != null, маппинг messageId', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.findMany.mockResolvedValue([
      {
        id: 'msgL',
        createdAt: new Date(),
        senderId: 'u2',
        sender: { id: 'u2' },
        linkPreview: { url: 'https://x.kz' },
      },
    ])
    const res = await service.listChatLinks(user('u1'), 'c1', { limit: 20 })
    expect(res.items).toHaveLength(1)
    expect(res.items[0]).toMatchObject({ messageId: 'msgL' })
    const where = prisma.message.findMany.mock.calls[0][0].where
    expect(where.linkPreview).toBeDefined()
  })
})

describe('ChatsService — опросы (§38–39)', () => {
  it('getPollResults: опрос не найден → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue(null)
    const err = await service.getPollResults(user('u1'), 'p1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  // F-F24: в удалённом опросе голос записывался, а poll:updated уходил всей комнате.
  it('опрос удалённого сообщения: ни голоса, ни результатов → NOT_FOUND', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      anonymous: false,
      multiple: false,
      allowRevote: true,
      closed: false,
      message: { chatId: 'c1', deletedAt: new Date() },
      options: [{ id: 'o1' }],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })

    const vote = await service.votePoll(user('u1'), 'p1', { optionIds: ['o1'] }).catch((e) => e)
    const results = await service.getPollResults(user('u1'), 'p1').catch((e) => e)

    expect(vote.code).toBe('NOT_FOUND')
    expect(results.code).toBe('NOT_FOUND')
    expect(prisma.chatPollVote.createMany).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })

  it('getPollResults: неанонимный опрос раскрывает проголосовавших по вариантам', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      anonymous: false,
      multiple: false,
      allowRevote: true,
      closed: false,
      message: { chatId: 'c1' },
      options: [
        { id: 'o1', text: 'Да', order: 0, _count: { votes: 1 } },
        { id: 'o2', text: 'Нет', order: 1, _count: { votes: 0 } },
      ],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.chatPollVote.findMany
      // Свои голоса.
      .mockResolvedValueOnce([{ optionId: 'o1' }])
      // Голоса всех — для раскрытия имён.
      .mockResolvedValueOnce([
        {
          optionId: 'o1',
          user: { id: 'u2', firstName: 'Айгуль', lastName: 'Сериковна', avatarUrl: null },
        },
      ])

    const res = await service.getPollResults(user('u1'), 'p1')

    expect(res.options[0]?.voters).toEqual([
      { id: 'u2', firstName: 'Айгуль', lastName: 'Сериковна', avatarUrl: null },
    ])
    // Вариант без голосов — пустой список, а не отсутствующее поле.
    expect(res.options[1]?.voters).toEqual([])
  })

  it('getPollResults: анонимный опрос личности не раскрывает и голосов не читает', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      anonymous: true,
      multiple: false,
      allowRevote: true,
      closed: false,
      message: { chatId: 'c1' },
      options: [{ id: 'o1', text: 'Да', order: 0, _count: { votes: 3 } }],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.chatPollVote.findMany.mockResolvedValue([])

    const res = await service.getPollResults(user('u1'), 'p1')

    expect(res.options[0]?.votes).toBe(3)
    expect(res.options[0]?.voters).toEqual([])
    // Запрос был только за своими голосами — второго обращения за именами быть не должно.
    expect(prisma.chatPollVote.findMany).toHaveBeenCalledTimes(1)
  })

  it('votePoll: не участник чата опроса → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      multiple: false,
      allowRevote: true,
      closed: false,
      message: { chatId: 'c1' },
      options: [{ id: 'o1' }, { id: 'o2' }],
    })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.votePoll(user('u1'), 'p1', { optionIds: ['o1'] }).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('votePoll: один вариант, а выбрано два → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      multiple: false,
      allowRevote: true,
      closed: false,
      message: { chatId: 'c1' },
      options: [{ id: 'o1' }, { id: 'o2' }],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    const err = await service
      .votePoll(user('u1'), 'p1', { optionIds: ['o1', 'o2'] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('votePoll: опрос завершён → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      multiple: true,
      allowRevote: true,
      closed: true,
      message: { chatId: 'c1' },
      options: [{ id: 'o1' }],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    const err = await service.votePoll(user('u1'), 'p1', { optionIds: ['o1'] }).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('votePoll: allowRevote=false и уже голосовал → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chatPoll.findUnique.mockResolvedValue({
      id: 'p1',
      multiple: false,
      allowRevote: false,
      closed: false,
      message: { chatId: 'c1' },
      options: [{ id: 'o1' }, { id: 'o2' }],
    })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    // Проверка «уже голосовал» идёт внутри транзакции под advisory-локом.
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      chatPollVote: {
        count: jest.fn().mockResolvedValue(1),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    }
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
    const err = await service.votePoll(user('u1'), 'p1', { optionIds: ['o2'] }).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.chatPollVote.createMany).not.toHaveBeenCalled()
  })
})

describe('ChatsService — seq сообщений', () => {
  it('createMessage пишет выданный аллокатором seq', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.$queryRaw.mockResolvedValue([{ last_seq: 42 }])
    prisma.message.create.mockResolvedValue({ id: 'msg1', chatId: 'c1', seq: 42 })

    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 42 }) }),
    )
  })

  it('аллокация и вставка идут одной транзакцией (порядок коммитов = порядок seq)', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue({ id: 'msg1', chatId: 'c1', seq: 1 })

    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    // Вне транзакции блокировка строки чата снималась бы сразу и меньший seq мог бы
    // закоммититься после большего — дельта догона пропустила бы такое сообщение.
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('чат исчез между проверкой членства и аллокацией → NOT_FOUND, сообщение не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.$queryRaw.mockResolvedValue([])

    const err = await service.createMessage('u1', { chatId: 'c1', content: 'hi' }).catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })
})

describe('ChatsService.getUpdates — дельта догона', () => {
  const member = { id: 'm1', clearedAt: null }

  it('не участник → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.getUpdates(user('u1'), 'c1', { since: 5 }).catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.message.findMany).not.toHaveBeenCalled()
  })

  it('отдаёт сообщения новее since и актуальный latestSeq', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(member)
    prisma.message.findMany.mockResolvedValueOnce([{ id: 'm6', seq: 6 }])
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 6 })

    const res = await service.getUpdates(user('u1'), 'c1', { since: 5 })

    expect(res).toEqual({
      created: [{ id: 'm6', seq: 6 }],
      mutated: [],
      deletedIds: [],
      latestSeq: 6,
      overflow: false,
      // Граница следующего догона — по часам сервера (BUG-113).
      syncedAt: expect.any(Date),
    })
    // Выборка новых идёт строго по seq, а не по времени.
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chatId: 'c1', deletedAt: null, seq: { gt: 5 } }),
        orderBy: { seq: 'asc' },
      }),
    )
  })

  it('без sinceTs правки и удаления не запрашиваются', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(member)
    prisma.message.findMany.mockResolvedValueOnce([])
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 5 })

    const res = await service.getUpdates(user('u1'), 'c1', { since: 5 })

    expect(prisma.message.findMany).toHaveBeenCalledTimes(1)
    expect(res.mutated).toEqual([])
    expect(res.deletedIds).toEqual([])
  })

  it('с sinceTs возвращает правки и id удалённых отдельно', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(member)
    prisma.message.findMany
      .mockResolvedValueOnce([]) // created
      .mockResolvedValueOnce([{ id: 'm2', seq: 2 }]) // mutated
      .mockResolvedValueOnce([{ id: 'm3' }]) // deleted
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 5 })

    const res = await service.getUpdates(user('u1'), 'c1', {
      since: 5,
      sinceTs: '2026-08-19T10:00:00.000Z',
    })

    expect(res.mutated).toEqual([{ id: 'm2', seq: 2 }])
    expect(res.deletedIds).toEqual(['m3'])
    // Мутации ищем только среди уже известных клиенту сообщений.
    expect(prisma.message.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ seq: { lte: 5 } }) }),
    )
  })

  // BUG-174: снятие закрепа обнуляло pinnedAt без следа — догон о нём не узнавал.
  it('правки ищет и по времени снятия закрепа', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(member)
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 5 })
    const sinceTs = '2026-08-19T10:00:00.000Z'

    await service.getUpdates(user('u1'), 'c1', { since: 5, sinceTs })

    expect(prisma.message.findMany.mock.calls[1][0].where.OR).toContainEqual({
      unpinnedAt: { gt: new Date(sinceTs) },
    })
  })

  it('разрыв больше лимита → overflow и пустой created (клиент перезапросит историю)', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(member)
    // Сервис берёт limit + 1, чтобы отличить «ровно лимит» от переполнения.
    const overflowing = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, seq: i + 1 }))
    prisma.message.findMany.mockResolvedValueOnce(overflowing)
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 201 })

    const res = await service.getUpdates(user('u1'), 'c1', { since: 0 })

    expect(res.overflow).toBe(true)
    expect(res.created).toEqual([])
    expect(res.latestSeq).toBe(201)
  })

  it('очищенная «у себя» история ограничивает дельту по clearedAt', async () => {
    const { service, prisma } = setup()
    const clearedAt = new Date('2026-08-18T00:00:00.000Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', clearedAt })
    prisma.message.findMany.mockResolvedValueOnce([])
    prisma.chat.findUnique.mockResolvedValueOnce({ lastSeq: 5 })

    await service.getUpdates(user('u1'), 'c1', { since: 5 })

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: [{ createdAt: { gt: clearedAt } }] }),
      }),
    )
  })
})

describe('ChatsService.createChat — один личный чат на пару', () => {
  it('существующий личный чат переиспользуется, второй не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce({ id: 'c-old', type: 'PRIVATE', title: null })
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await service.createChat(user('u1'), { type: 'PRIVATE', memberIds: ['u2'] })

    expect(res).toEqual({ id: 'c-old', type: 'PRIVATE', title: null })
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  // BUG-172: окно открывалось по id чата, которого нет в списке, — без шапки и плашки.
  it('скрытый у себя личный чат «Написать» возвращает в список', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce({ id: 'c-old', type: 'PRIVATE', title: null })
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 1 })

    await service.createChat(user('u1'), { type: 'PRIVATE', memberIds: ['u2'] })

    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { chatId: 'c-old', userId: 'u1', hiddenAt: { not: null } },
      data: { hiddenAt: null },
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'c-old' })
  })

  it('поиск требует ровно двух участников пары: третий в чате его не подходит', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.chat.create.mockResolvedValueOnce({ id: 'c-new', type: 'PRIVATE', title: null })

    await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    // `every` отсекает чаты с третьим участником, два `some` требуют обоих из пары.
    expect(prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'PRIVATE',
          members: { every: { userId: { in: ['u1', 'u2'] } } },
          AND: [{ members: { some: { userId: 'u1' } } }, { members: { some: { userId: 'u2' } } }],
        },
      }),
    )
  })

  it('чата ещё нет — создаётся новый', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.chat.create.mockResolvedValueOnce({ id: 'c-new', type: 'PRIVATE', title: null })

    const res = await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    expect(res.id).toBe('c-new')
    expect(prisma.chat.create).toHaveBeenCalledTimes(1)
  })

  it('не-другу чат заводится запросом на переписку (§50)', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.chat.create.mockResolvedValueOnce({
      id: 'c-new',
      type: 'PRIVATE',
      title: null,
      requestPendingForId: 'u2',
    })

    const res = await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    expect(res.requestPendingForId).toBe('u2')
    expect(prisma.chat.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestPendingForId: 'u2' }) }),
    )
  })

  it('другу — обычный чат без запроса: роль адресата тут ни при чём, важна только дружба', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.friendship.findFirst.mockResolvedValueOnce({ id: 'f1' })
    prisma.chat.create.mockResolvedValueOnce({
      id: 'c-new',
      type: 'PRIVATE',
      title: null,
      requestPendingForId: null,
    })

    // Друг — из другого вуза: дружба снимает правило «свой вуз».
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni2' })

    await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    expect(prisma.chat.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestPendingForId: null }) }),
    )
  })

  // BUG-028: охрана, библиотекарь и работодатель целью личного чата не бывают (§2.1, §19 п.9).
  it.each(['SECURITY_GUARD', 'LIBRARIAN', 'EMPLOYER'])(
    'собеседник %s → FORBIDDEN',
    async (role) => {
      const { service, prisma } = setup()
      prisma.chat.findFirst.mockResolvedValueOnce(null)
      prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1', role })

      const err = await service
        .createChat({ ...user('u1'), universityId: 'uni1' }, { type: 'PRIVATE', memberIds: ['u2'] })
        .catch((e) => e)

      expect(err.code).toBe('FORBIDDEN')
      expect(prisma.chat.create).not.toHaveBeenCalled()
    },
  )

  // F-F24: memberIds: [свой id] проходил схему и создавал PRIVATE с одним участником.
  it('личный чат «с собой» → VALIDATION_ERROR, чат не создаётся', async () => {
    const { service, prisma } = setup()

    const err = await service
      .createChat({ ...user('u1'), universityId: 'uni1' }, { type: 'PRIVATE', memberIds: ['u1'] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  // F-F24: платформенной роли и другу проверка собеседника не делалась — несуществующий id
  // доходил до вставки, и FK-ошибка уходила наружу как 500.
  it.each([
    ['платформенная роль', { ...user('a1'), role: Role.PLATFORM_ADMIN }, false],
    ['друг', { ...user('u1'), universityId: 'uni1' }, true],
  ])('%s: несуществующий собеседник → NOT_FOUND, а не 500', async (_label, actor, friends) => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    if (friends) prisma.friendship.findFirst.mockResolvedValueOnce({ id: 'f1' })
    prisma.user.findFirst.mockResolvedValueOnce(null)

    const err = await service
      .createChat(actor, { type: 'PRIVATE', memberIds: ['ghost'] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  it('человеку из чужого вуза личный чат не заводится', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni2' })

    const err = await service
      .createChat({ ...user('u1'), universityId: 'uni1' }, { type: 'PRIVATE', memberIds: ['u2'] })
      .catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  it('создание чата само по себе адресата не уведомляет — только первое сообщение', async () => {
    const { service, prisma, queue } = setup()
    prisma.chat.findFirst.mockResolvedValueOnce(null)
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1' })
    prisma.chat.create.mockResolvedValueOnce({
      id: 'c-new',
      type: 'PRIVATE',
      title: null,
      requestPendingForId: 'u2',
    })

    await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('новый личный чат создаётся под локом пары — одним и тем же с любой стороны', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(null)
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni1' })
    prisma.chat.create.mockResolvedValue({ id: 'c-new', type: 'PRIVATE', title: null })

    await service.createChat(
      { ...user('u2'), universityId: 'uni1' },
      {
        type: 'PRIVATE',
        memberIds: ['u1'],
      },
    )
    await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      {
        type: 'PRIVATE',
        memberIds: ['u2'],
      },
    )

    expect(prisma.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      'chat-create:PRIVATE:u1:u2',
      'chat-create:PRIVATE:u1:u2',
    ])
  })

  // F-F05: двойной клик «Написать» из двух вкладок — оба запроса видят «чата нет».
  it('гонка: под локом пары находится чат первого запроса, второй не создаётся', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'c-first', type: 'PRIVATE', title: null })
    prisma.user.findFirst.mockResolvedValueOnce({ universityId: 'uni1' })

    const res = await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'PRIVATE', memberIds: ['u2'] },
    )

    expect(res).toEqual({ id: 'c-first', type: 'PRIVATE', title: null })
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  it('группу не ищем — её создают явно, с собственным названием', async () => {
    const { service, prisma } = setup()
    prisma.chat.create.mockResolvedValueOnce({ id: 'g1', type: 'GROUP', title: 'Проект' })
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u2', universityId: 'uni1', role: 'STUDENT' },
      { id: 'u3', universityId: 'uni1', role: 'STUDENT' },
    ])

    await service.createChat(
      { ...user('u1'), universityId: 'uni1' },
      { type: 'GROUP', title: 'Проект', memberIds: ['u2', 'u3'] },
    )

    expect(prisma.chat.findFirst).not.toHaveBeenCalled()
    expect(prisma.chat.create).toHaveBeenCalledTimes(1)
  })
})

describe('ChatsService — группа не обходит правила личной переписки', () => {
  const me = { ...user('u1'), universityId: 'uni1' }

  it('работодатель чаты не создаёт', async () => {
    const { service, prisma } = setup()
    const err = await service
      .createChat(
        { ...user('e1'), role: 'EMPLOYER' as never },
        { type: 'GROUP', memberIds: ['u2'] },
      )
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  it('в группу нельзя позвать того, кто тебя заблокировал', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u2', universityId: 'uni1', role: 'STUDENT' },
    ])
    prisma.userBlock.findFirst.mockResolvedValueOnce({ id: 'b1' })
    const err = await service.createChat(me, { type: 'GROUP', memberIds: ['u2'] }).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chat.create).not.toHaveBeenCalled()
  })

  it('человека чужого вуза без дружбы в группу не позвать', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u9', universityId: 'uni2', role: 'STUDENT' },
    ])
    const err = await service.createChat(me, { type: 'GROUP', memberIds: ['u9'] }).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('друга из чужого вуза — можно', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([
      { id: 'u9', universityId: 'uni2', role: 'STUDENT' },
    ])
    prisma.friendship.findMany.mockResolvedValueOnce([{ requesterId: 'u9', addresseeId: 'u1' }])
    prisma.chat.create.mockResolvedValueOnce({ id: 'g1', type: 'GROUP', title: null })
    await service.createChat(me, { type: 'GROUP', memberIds: ['u9'] })
    expect(prisma.chat.create).toHaveBeenCalled()
  })

  it('несуществующий или удалённый пользователь — NOT_FOUND, а не 500', async () => {
    const { service, prisma } = setup()
    prisma.user.findMany.mockResolvedValueOnce([])
    const err = await service
      .createChat(me, { type: 'GROUP', memberIds: ['ghost'] })
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('ChatsService — вступление по ссылке-приглашению', () => {
  const me = { ...user('u5'), universityId: 'uni1' }

  it('без верного кода не пускает, ответ как у несуществующего чата', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      inviteCode: 'secret-code-1',
    })
    const err = await service.joinByInvite(me, 'g1', 'wrong-code').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.chatMember.create).not.toHaveBeenCalled()
  })

  it('забаненного верный код не пускает', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      inviteCode: 'secret-code-1',
    })
    prisma.chatMember.findUnique.mockResolvedValueOnce({ id: 'm1', bannedAt: new Date() })
    const err = await service.joinByInvite(me, 'g1', 'secret-code-1').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('верный код — участник добавляется', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      inviteCode: 'secret-code-1',
    })
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    prisma.message.create.mockResolvedValue({ id: 'sys', createdAt: new Date() })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: new Date() })
    await service.joinByInvite(me, 'g1', 'secret-code-1')
    // История до вступления — не непрочитанное: отметка прочтения ставится на момент входа.
    expect(prisma.chatMember.create).toHaveBeenCalledWith({
      data: { chatId: 'g1', userId: 'u5', lastReadAt: expect.any(Date) },
    })
  })

  // F-F17: вступивший по ссылке был невидим для группы до перезагрузки.
  it('вступление видно группе: участник в открытом окне и служебная строка в ленте', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      inviteCode: 'secret-code-1',
    })
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    const joiner = { id: 'u5', firstName: 'Ая', lastName: 'Ли', avatarUrl: null }
    prisma.user.findUnique.mockResolvedValue(joiner)
    prisma.message.create.mockResolvedValue({ id: 'sys', createdAt: new Date() })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: new Date() })
    prisma.chatMember.findMany.mockResolvedValueOnce([
      { id: 'a', userId: 'u1' },
      { id: 'b', userId: 'u5' },
    ])

    await service.joinByInvite(me, 'g1', 'secret-code-1')

    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:g1', 'chat:member-added', {
      chatId: 'g1',
      user: joiner,
    })
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatId: 'g1',
          senderId: 'u5',
          systemType: 'member_joined',
        }),
      }),
    )
    // Служебная строка будит списки всех участников, вступившего тоже.
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'g1' })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u5', 'chat:activity', { chatId: 'g1' })
  })

  it('двойной вход (гонка двух запросов) — успех без 500 и без второго объявления', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findUnique.mockResolvedValueOnce({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      inviteCode: 'secret-code-1',
    })
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    prisma.chatMember.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    await expect(service.joinByInvite(me, 'g1', 'secret-code-1')).resolves.toEqual({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
    })
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })
})

// F-F17: бан был беззвучным — группа и сам забаненный узнавали о нём перезагрузкой.
describe('ChatsService.banMember', () => {
  const owner = { ...user('owner'), universityId: 'uni1' }

  function banSetup() {
    const ctx = setup()
    ctx.prisma.chatMember.findUnique.mockResolvedValue({ isAdmin: true, bannedAt: null })
    ctx.prisma.chat.findUnique.mockResolvedValue({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      avatarUrl: null,
      createdById: 'owner',
    })
    ctx.prisma.user.findUnique.mockResolvedValue({ firstName: 'Ая', lastName: 'Ли' })
    ctx.prisma.message.create.mockResolvedValue({ id: 'sys', createdAt: new Date() })
    ctx.prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: new Date() })
    return ctx
  }

  it('объявляет бан: служебная строка, состав в открытых окнах, сигнал забаненному', async () => {
    const { service, prisma, realtime } = banSetup()
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 1 })

    await expect(service.banMember(owner, 'g1', 'u2')).resolves.toEqual({
      chatId: 'g1',
      userId: 'u2',
      banned: true,
    })

    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { chatId: 'g1', userId: 'u2', bannedAt: null },
      data: { bannedAt: expect.any(Date) },
    })
    expect(realtime.leaveRoom).toHaveBeenCalledWith('u2', 'chat:g1')
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:g1', 'chat:member-removed', {
      chatId: 'g1',
      userId: 'u2',
    })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u2', 'chat:activity', { chatId: 'g1' })
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemType: 'member_banned',
          systemMeta: { targetName: 'Ли Ая' },
        }),
      }),
    )
  })

  it('повторный бан уже забаненного — без второй строки в ленте', async () => {
    const { service, prisma, realtime } = banSetup()
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 0 })

    await expect(service.banMember(owner, 'g1', 'u2')).resolves.toMatchObject({ banned: true })
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(realtime.emitToRoom).not.toHaveBeenCalled()
  })

  // BUG-177: разбан был беззвучным, а всё написанное за время бана становилось непрочитанным.
  it('разбан двигает отметку прочтения и объявляет возвращение', async () => {
    const { service, prisma, realtime } = banSetup()
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 1 })
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', firstName: 'Ая', lastName: 'Ли' })

    await expect(service.unbanMember(owner, 'g1', 'u2')).resolves.toMatchObject({
      banned: false,
    })

    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: { chatId: 'g1', userId: 'u2', bannedAt: { not: null } },
      data: { bannedAt: null, lastReadAt: expect.any(Date) },
    })
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:g1', 'chat:member-added', {
      chatId: 'g1',
      user: expect.objectContaining({ id: 'u2' }),
    })
  })

  // BUG-170: бан — только создатель группы (§8.3), админ им не распоряжается.
  it('админ, не создатель → FORBIDDEN, бана нет', async () => {
    const { service, prisma } = banSetup()
    const err = await service.banMember(user('admin2'), 'g1', 'u2').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })

  it('не участник → NOT_FOUND', async () => {
    const { service, prisma } = banSetup()
    prisma.chatMember.updateMany.mockResolvedValueOnce({ count: 0 })
    prisma.chatMember.findUnique
      .mockResolvedValueOnce({ isAdmin: true, bannedAt: null })
      .mockResolvedValueOnce(null)

    const err = await service.banMember(owner, 'g1', 'ghost').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('ChatsService.removeMember', () => {
  const owner = { ...user('owner'), universityId: 'uni1' }

  function kickSetup() {
    const ctx = setup()
    ctx.prisma.chatMember.findUnique.mockResolvedValue({ isAdmin: true, bannedAt: null })
    ctx.prisma.chat.findUnique.mockResolvedValue({
      id: 'g1',
      type: 'GROUP',
      title: 'Проект',
      avatarUrl: null,
      createdById: 'owner',
    })
    ctx.prisma.user.findUnique.mockResolvedValue({ firstName: 'Ая', lastName: 'Ли' })
    ctx.prisma.message.create.mockResolvedValue({ id: 'sys', createdAt: new Date() })
    ctx.prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: new Date() })
    return ctx
  }

  // BUG-176: исключение того, кого в группе нет, писало в ленту ложное «исключил X».
  it('не участник → NOT_FOUND, без служебной строки и смены ссылки', async () => {
    const { service, prisma } = kickSetup()
    prisma.chatMember.deleteMany.mockResolvedValueOnce({ count: 0 })

    const err = await service.removeMember(owner, 'g1', 'ghost').catch((e) => e)

    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(prisma.chat.update).not.toHaveBeenCalled()
  })

  // BUG-170: админы не исключают друг друга — это решает создатель.
  it('админ не исключает другого админа', async () => {
    const { service, prisma } = kickSetup()
    prisma.chatMember.findUnique
      .mockResolvedValueOnce({ isAdmin: true, bannedAt: null })
      .mockResolvedValueOnce({ isAdmin: true })

    const err = await service.removeMember(user('admin2'), 'g1', 'admin3').catch((e) => e)

    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
  })

  it('участник исключается со служебной строкой', async () => {
    const { service, prisma } = kickSetup()
    prisma.chatMember.deleteMany.mockResolvedValueOnce({ count: 1 })

    await service.removeMember(owner, 'g1', 'u2')

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ systemType: 'member_removed' }),
      }),
    )
  })
})

describe('ChatsService — запрос на переписку (§50)', () => {
  // Личный чат, ждущий решения u2. Тот же объект отдаёт и findUnique (проверки внутри
  // отправки), и findFirst (адресация accept/decline).
  const pending = {
    id: 'c1',
    type: 'PRIVATE',
    members: [{ userId: 'u2' }],
    requestPendingForId: 'u2',
  }

  const messageRow = (senderId: string) => ({
    id: 'msg1',
    chatId: 'c1',
    senderId,
    content: 'hi',
    replyToId: null,
    editedAt: null,
    createdAt: new Date(),
    sender: { id: senderId, firstName: 'A', lastName: 'B', avatarUrl: null },
  })

  it('первое сообщение инициатора шлёт адресату запрос, но не уведомление о сообщении', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue(pending)
    prisma.message.create.mockResolvedValue(messageRow('u1'))
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }])
    prisma.user.findUnique.mockResolvedValue({ firstName: 'Иван', lastName: 'Иванов' })

    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    // Адресата нет среди получателей уведомления о сообщении — оно бы обошло согласие.
    expect(res.recipientIds).toEqual([])
    const jobs = queue.enqueue.mock.calls.map((c) => c[2])
    const request = jobs.find((j) => j.dedupeKey === 'chat-request:c1')
    expect(request).toBeDefined()
    expect(request.type).toBe('SYSTEM')
    expect(request.recipientIds).toEqual(['u2'])
    expect(jobs.some((j) => j.type === 'MESSAGE')).toBe(false)
  })

  it('ответ адресата принимает запрос — дальше чат обычный', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm2' })
    prisma.chat.findUnique.mockResolvedValue(pending)
    prisma.message.create.mockResolvedValue(messageRow('u2'))
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }])

    const res = await service.createMessage('u2', { chatId: 'c1', content: 'hi' })

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { requestPendingForId: null },
    })
    // Инициатор получает обычное уведомление: согласие уже дано.
    expect(res.recipientIds).toEqual(['u1'])
  })

  it('accept снимает пометку и гасит уведомление о запросе', async () => {
    const { service, prisma, notifications } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'c1', requestPendingForId: 'u2' })
    prisma.chat.update.mockResolvedValue({})

    await service.acceptChatRequest('u2', 'c1')

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { requestPendingForId: null },
    })
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'chat-request:c1' },
    })
    // Бейдж колокольчика не держит удалённое уведомление до истечения кэша.
    expect(notifications.invalidateUnread).toHaveBeenCalledWith('u2')
  })

  it('принятая дружба снимает висящий запрос пары (clearRequestBetween)', async () => {
    const { service, prisma, notifications, realtime } = setup()
    prisma.chat.findFirst.mockResolvedValue({
      id: 'c1',
      type: 'PRIVATE',
      title: null,
      requestPendingForId: 'u2',
    })
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])

    await service.clearRequestBetween('u1', 'u2')

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { requestPendingForId: null },
    })
    expect(notifications.invalidateUnread).toHaveBeenCalledWith('u2')
    expect(realtime.emitToUser).toHaveBeenCalledWith('u2', 'chat:activity', { chatId: 'c1' })
  })

  it('clearRequestBetween без висящего запроса ничего не пишет', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue({
      id: 'c1',
      type: 'PRIVATE',
      title: null,
      requestPendingForId: null,
    })

    await service.clearRequestBetween('u1', 'u2')

    expect(prisma.chat.update).not.toHaveBeenCalled()
  })

  it('принять запрос может только адресат, не инициатор', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'c1', requestPendingForId: 'u2' })

    const err = await service.acceptChatRequest('u1', 'c1').catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.chat.update).not.toHaveBeenCalled()
  })

  it('повторное решение по уже принятому запросу → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'c1', requestPendingForId: null })

    const err = await service.acceptChatRequest('u2', 'c1').catch((e) => e)

    expect(err.code).toBe('CONFLICT')
  })

  it('decline удаляет чат целиком — переписки не остаётся ни у кого', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'c1', requestPendingForId: 'u2' })
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])

    await service.declineChatRequest('u2', 'c1')

    expect(prisma.chat.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:activity', { chatId: 'c1' })
  })

  it('отказ инициатору не уведомляется — как и с заявкой в друзья', async () => {
    const { service, prisma, queue } = setup()
    prisma.chat.findFirst.mockResolvedValue({ id: 'c1', requestPendingForId: 'u2' })
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])

    await service.declineChatRequest('u2', 'c1')

    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('успевшая сложиться дружба снимает висящий запрос сама', async () => {
    const { service, prisma, queue } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue(pending)
    prisma.friendship.findFirst.mockResolvedValue({ id: 'f1' })
    prisma.message.create.mockResolvedValue(messageRow('u1'))
    prisma.chat.update.mockResolvedValue({})
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u2' }])

    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    expect(prisma.chat.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { requestPendingForId: null },
    })
    expect(res.recipientIds).toEqual(['u2'])
    expect(queue.enqueue.mock.calls.every((c) => c[2].dedupeKey !== 'chat-request:c1')).toBe(true)
  })
})

describe('ChatsService — общие условия отправки (assertCanSend)', () => {
  // Личный чат, где второй участник — u2.
  const priv = { type: 'PRIVATE', members: [{ userId: 'u2' }], requestPendingForId: null }

  const messageRow = () => ({
    id: 'm-new',
    chatId: 'c1',
    senderId: 'u1',
    content: 'hi',
    replyToId: null,
    editedAt: null,
    createdAt: new Date(),
    sender: { id: 'u1', firstName: 'A', lastName: 'B', avatarUrl: null },
    media: [],
  })

  function blockedSetup() {
    const s = setup()
    s.prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    s.prisma.chat.findUnique.mockResolvedValue(priv)
    // Блокировка в любую сторону между u1 и u2.
    s.prisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' })
    return s
  }

  it('пересылка в личный чат к заблокировавшему — FORBIDDEN, сообщение не создаётся', async () => {
    const { service, prisma } = blockedSetup()

    const err = await service.forwardMessage(user('u1'), 'c1', 'src1').catch((e) => e)

    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('«поделиться постом» в личный чат к заблокировавшему — FORBIDDEN', async () => {
    const { service, prisma, posts } = blockedSetup()

    const err = await service.sharePost(user('u1'), 'c1', 'p1').catch((e) => e)

    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.create).not.toHaveBeenCalled()
    // До проверки видимости поста дело не доходит — отправка запрещена раньше.
    expect(posts.assertVisibleToViewer).not.toHaveBeenCalled()
  })

  // BUG-163: правка, закрепление и «печатает» идут теми же правилами, что и отправка.
  it('правка своего сообщения в чате с заблокировавшим — FORBIDDEN', async () => {
    const { service, prisma } = blockedSetup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      forwardedFromId: null,
    })
    const err = await service.editMessage('u1', 'm1', 'x').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.update).not.toHaveBeenCalled()
  })

  it('закрепление в чате с заблокировавшим — FORBIDDEN, без служебной строки', async () => {
    const { service, prisma } = blockedSetup()
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    const err = await service.setPinned('u1', 'm1', true).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.update).not.toHaveBeenCalled()
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('закрепление в непринятый запрос сверх потолка — FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue({ ...priv, requestPendingForId: 'u2' })
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', chatId: 'c1' })
    prisma.message.count.mockResolvedValue(5)
    const err = await service.setPinned('u1', 'm1', true).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('правка в непринятом запросе потолком не ограничена', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue({ ...priv, requestPendingForId: 'u2' })
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      chatId: 'c1',
      senderId: 'u1',
      createdAt: new Date(),
      forwardedFromId: null,
    })
    prisma.message.count.mockResolvedValue(5)
    prisma.message.update.mockResolvedValue({ id: 'm1', chatId: 'c1', seq: 1 })
    await expect(service.editMessage('u1', 'm1', 'x')).resolves.toMatchObject({ id: 'm1' })
  })

  it('«печатает» заблокировавшему и адресату непринятого запроса не уходит', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    prisma.chat.findUnique.mockResolvedValue({ type: 'PRIVATE', requestPendingForId: null })
    prisma.userBlock.findFirst.mockResolvedValueOnce({ id: 'b1' })
    await expect(service.actionAudience('u1', 'c1')).resolves.toEqual({ kind: 'denied' })

    prisma.chat.findUnique.mockResolvedValue({ type: 'PRIVATE', requestPendingForId: 'u2' })
    await expect(service.actionAudience('u1', 'c1')).resolves.toEqual({ kind: 'denied' })

    // Адресат запроса сам печатает инициатору — это уже ответ, его видно.
    await expect(service.actionAudience('u2', 'c1')).resolves.toEqual({
      kind: 'users',
      userIds: ['u1'],
    })
  })

  it('пересылка считается в антифлуд наравне с обычной отправкой', async () => {
    const { service, prisma, redis } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    redis.incr.mockResolvedValue(21)

    const err = await service.forwardMessage(user('u1'), 'c1', 'src1').catch((e) => e)

    expect(err.code).toBe('RATE_LIMIT')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('окно антифлуда ставится один раз — на первом сообщении', async () => {
    const { service, prisma, redis } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue(messageRow())
    prisma.chat.update.mockResolvedValue({})

    redis.incr.mockResolvedValue(1)
    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })
    expect(redis.expire).toHaveBeenCalledWith('chat:flood:u1', 10)

    redis.expire.mockClear()
    redis.incr.mockResolvedValue(2)
    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('Redis недоступен — отправка не блокируется (fail-open)', async () => {
    const { service, prisma, redis } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue(messageRow())
    prisma.chat.update.mockResolvedValue({})
    redis.incr.mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    expect(res.message.id).toBe('m-new')
  })

  it('§50: инициатор упирается в потолок сообщений до принятия запроса', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.chat.findUnique.mockResolvedValue({ ...priv, requestPendingForId: 'u2' })
    prisma.message.count.mockResolvedValue(5)

    const err = await service.createMessage('u1', { chatId: 'c1', content: 'hi' }).catch((e) => e)

    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.message.create).not.toHaveBeenCalled()
    // F-F24: удалённые тоже в счёт — иначе потолок обходился удалением своих сообщений.
    expect(prisma.message.count).toHaveBeenCalledWith({ where: { chatId: 'c1', senderId: 'u1' } })
  })

  // F-F22: собеседник нужен только личному чату — состав группы на каждое сообщение не читаем.
  it('проверка отправки читает не больше одного участника', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    prisma.message.create.mockResolvedValue(messageRow())
    prisma.chat.update.mockResolvedValue({})

    await service.createMessage('u1', { chatId: 'c1', content: 'hi' })

    const select = prisma.chat.findUnique.mock.calls[0][0].select
    expect(select.members).toEqual({
      where: { userId: { not: 'u1' } },
      select: { userId: true },
      take: 1,
    })
  })

  it('§50: потолок не касается адресата — его ответ и есть принятие', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm2' })
    prisma.chat.findUnique.mockResolvedValue({ ...priv, requestPendingForId: 'u2' })
    prisma.message.count.mockResolvedValue(99)
    prisma.message.create.mockResolvedValue({ ...messageRow(), senderId: 'u2' })
    prisma.chat.update.mockResolvedValue({})

    const res = await service.createMessage('u2', { chatId: 'c1', content: 'ok' })

    expect(res.message.id).toBe('m-new')
  })
})

// Прочтение — «до этого сообщения», а не «всё на сейчас»: иначе счётчик непрочитанного
// обнулялся от любого прочтения, и дочитать переписку до середины было нельзя.
// Дружба открывает закрытый профиль: без разрыва заблокированный бывший друг продолжал бы
// видеть фото и альбомы того, кто от него закрылся, а висящую заявку можно было принять.
describe('ChatsService.blockUser — рвёт дружбу', () => {
  it('удаляет дружбу и заявки в обе стороны и гасит уведомление-заявку — в одной транзакции', async () => {
    const { service, prisma, notifications } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'u2' })
    prisma.friendship.findMany.mockResolvedValue([{ id: 'f1' }])

    await service.blockUser('u1', 'u2')

    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.userBlock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { blockerId: 'u1', blockedId: 'u2' } }),
    )
    expect(prisma.friendship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { requesterId: 'u1', addresseeId: 'u2' },
            { requesterId: 'u2', addresseeId: 'u1' },
          ],
        },
      }),
    )
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['f1'] } } })
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { dedupeKey: { in: ['friend-request:f1'] } },
    })
    expect(notifications.invalidateUnread).toHaveBeenCalledWith('u1')
    expect(notifications.invalidateUnread).toHaveBeenCalledWith('u2')
  })

  it('без дружбы — только блокировка', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'u2' })

    const res = await service.blockUser('u1', 'u2')

    expect(res).toEqual({ userId: 'u2', blocked: true })
    expect(prisma.userBlock.upsert).toHaveBeenCalled()
    expect(prisma.friendship.deleteMany).not.toHaveBeenCalled()
  })
})

describe('ChatsService.markRead', () => {
  const at = new Date('2026-09-01T10:00:00.000Z')

  it('ставит отметку по времени сообщения и только вперёд', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.message.findFirst.mockResolvedValue({ createdAt: at })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: at })

    const res = await service.markRead('u1', 'c1', 'msg-1')

    expect(prisma.message.findFirst).toHaveBeenCalledWith({
      where: { id: 'msg-1', chatId: 'c1' },
      select: { createdAt: true },
    })
    // Условие «отметки нет или она раньше» — и есть «только вперёд»: более старое
    // прочтение, пришедшее позже, под него не попадает и ничего не меняет.
    expect(prisma.chatMember.updateMany).toHaveBeenCalledWith({
      where: {
        chatId: 'c1',
        userId: 'u1',
        OR: [{ lastReadAt: null }, { lastReadAt: { lt: at } }],
      },
      data: { lastReadAt: at },
    })
    expect(res.readAt).toEqual(at)
  })

  it('отдаёт действующую отметку, если прочтение старее уже сохранённой', async () => {
    const { service, prisma } = setup()
    const later = new Date('2026-09-01T12:00:00.000Z')
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.message.findFirst.mockResolvedValue({ createdAt: at })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: later })

    const res = await service.markRead('u1', 'c1', 'old-msg')

    expect(res.readAt).toEqual(later)
  })

  it('сообщает читателю в его личную комнату — для счётчика на других устройствах', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.message.findFirst.mockResolvedValue({ createdAt: at })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: at })

    await service.markRead('u1', 'c1', 'msg-1')

    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'chat:read', {
      chatId: 'c1',
      readAt: at,
    })
  })

  it('гасит свёрнутую строку чата в колокольчике и сбрасывает кэш счётчика', async () => {
    const { service, prisma, redis } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.message.findFirst.mockResolvedValue({ createdAt: at })
    prisma.chatMember.findFirst.mockResolvedValue({ lastReadAt: at })
    prisma.notification.updateMany.mockResolvedValue({ count: 1 })

    await service.markRead('u1', 'c1', 'msg-1')

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', dedupeKey: 'new-message:chat:c1', isRead: false },
      data: { isRead: true, readAt: expect.any(Date) },
    })
    expect(redis.del).toHaveBeenCalledWith('notif:unread:u1')
  })

  it('сообщение из другого чата — NOT_FOUND, отметка не трогается', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1', bannedAt: null })
    prisma.message.findFirst.mockResolvedValue(null)

    await expect(service.markRead('u1', 'c1', 'foreign')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })

  it('не участник — отказ до любых изменений', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue(null)

    await expect(service.markRead('u1', 'c1', 'msg-1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.chatMember.updateMany).not.toHaveBeenCalled()
  })
})

describe('ChatsService — доставка отложенных', () => {
  const row = {
    id: 's1',
    chatId: 'c1',
    senderId: 'u1',
    content: 'привет',
    replyToId: null,
    replyQuote: null,
    silent: false,
    scheduledAt: new Date(),
  }

  function primed(claimed: number) {
    const ctx = setup()
    const scheduledMessage = {
      findMany: jest.fn().mockResolvedValue([row]),
      deleteMany: jest.fn().mockResolvedValue({ count: claimed }),
    }
    ;(ctx.prisma as unknown as { scheduledMessage: typeof scheduledMessage }).scheduledMessage =
      scheduledMessage
    const send = jest
      .spyOn(ctx.service, 'createMessage')
      .mockResolvedValue({ message: { id: 'm1' } as never, recipientIds: [] })
    return { ...ctx, scheduledMessage, send }
  }

  it('строку уже забрал другой инстанс → не отправляем второй раз', async () => {
    const { service, send } = primed(0)
    await expect(service.deliverDueScheduled()).resolves.toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('забрал сам → отправляет и шлёт message:new в комнату чата', async () => {
    const { service, send, realtime, scheduledMessage } = primed(1)
    await expect(service.deliverDueScheduled()).resolves.toBe(1)
    expect(scheduledMessage.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0] ?? 0,
    )
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', {
      message: { id: 'm1' },
      chatId: 'c1',
    })
  })

  // F-F19: уведомление уходит в push и письмом — текста сообщения в нём быть не должно.
  it('не ушло → автору уведомление без текста сообщения', async () => {
    const { service, send, queue } = primed(1)
    send.mockRejectedValueOnce(new AppException('FORBIDDEN', 'Вы заблокированы'))
    await expect(service.deliverDueScheduled()).resolves.toBe(0)
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    const job = queue.enqueue.mock.calls[0][2]
    expect(job.recipientIds).toEqual(['u1'])
    expect(job.titleKey).toBe('chats.scheduledFailed.title')
    expect(job.body).toBeUndefined()
    expect(JSON.stringify(job)).not.toContain('привет')
  })
})

// F-F21: прежний аватар группы удалялся ДО проверки нового — отказ по типу оставлял
// `avatarUrl` на уже удалённый объект, и у группы висела битая картинка.
// BUG-109: файл аватара жил на загрузившем и уходил каскадом с его надгробием — группа
// теряла аватар у всех. Теперь он на создателе и переезжает при передаче владения.
describe('ChatsService — аватар группы живёт на создателе', () => {
  it('загрузка заводит файл на создателя группы', async () => {
    const { service, prisma, files } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ isAdmin: true, bannedAt: null })
    prisma.chat.findUnique.mockResolvedValue({
      id: 'g1',
      type: 'GROUP',
      title: 'Группа',
      avatarUrl: null,
      createdById: 'u1',
    })
    prisma.message.create.mockResolvedValue({ id: 'sys1', createdAt: new Date() })
    files.upload.mockResolvedValue({ id: 'new-file', key: 'new.png' })
    prisma.chat.update.mockResolvedValue({ id: 'g1', avatarUrl: 'http://minio/avatars/new.png' })

    await service.setChatAvatar(user('u1'), 'g1', Buffer.from('png'))

    expect(files.upload).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'u1' }))
  })

  it('передача владения переводит файл аватара на нового создателя', async () => {
    const { service, prisma, config } = setup()
    config.get.mockImplementation((key: string) =>
      key === 'MINIO_BUCKET_AVATARS' ? 'avatars' : 'chat-media',
    )
    prisma.chat.findUnique
      .mockResolvedValueOnce({ id: 'g1', type: 'GROUP', createdById: 'u1' })
      .mockResolvedValueOnce({ avatarUrl: 'http://minio/avatars/group.png' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem2', bannedAt: null })
    prisma.$transaction.mockImplementationOnce(async (ops: unknown) => ops)
    prisma.message.create.mockResolvedValue({ id: 'sys1', createdAt: new Date() })

    await service.transferOwnership(user('u1'), 'g1', 'u2')

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { key: 'group.png', bucket: 'avatars' },
      data: { ownerId: 'u2' },
    })
  })
})

describe('ChatsService.setChatAvatar — замена аватара', () => {
  function avatarSetup() {
    const harness = setup()
    const { prisma } = harness
    prisma.chatMember.findUnique.mockResolvedValue({ isAdmin: true, bannedAt: null })
    prisma.chat.findUnique.mockResolvedValue({
      id: 'c1',
      type: 'GROUP',
      title: 'Группа',
      avatarUrl: 'http://minio/chat-media/old.png',
      createdById: 'u1',
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'old-file' })
    prisma.message.create.mockResolvedValue({
      id: 'sys1',
      chatId: 'c1',
      seq: 1,
      createdAt: new Date(),
    })
    return harness
  }

  it('новый файл принимается и записывается раньше, чем удаляется прежний', async () => {
    const { service, prisma, files } = avatarSetup()
    files.upload.mockResolvedValue({ id: 'new-file', key: 'new.png' })
    prisma.chat.update.mockResolvedValue({ id: 'c1', avatarUrl: 'http://minio/chat-media/new.png' })

    await service.setChatAvatar(user('u1'), 'c1', Buffer.from('png'))

    expect(files.delete).toHaveBeenCalledWith('old-file')
    const uploadedAt = files.upload.mock.invocationCallOrder[0] ?? Infinity
    const savedAt = prisma.chat.update.mock.invocationCallOrder[0] ?? Infinity
    const deletedAt = files.delete.mock.invocationCallOrder[0] ?? 0
    expect(uploadedAt).toBeLessThan(savedAt)
    expect(savedAt).toBeLessThan(deletedAt)
  })

  it('новый файл отклонён — прежний аватар остаётся на месте', async () => {
    const { service, prisma, files } = avatarSetup()
    files.upload.mockRejectedValue(new AppException('BAD_REQUEST', 'Недопустимый тип файла'))

    const err = await service.setChatAvatar(user('u1'), 'c1', Buffer.from('exe')).catch((e) => e)

    expect(err.code).toBe('BAD_REQUEST')
    expect(files.delete).not.toHaveBeenCalled()
    expect(prisma.chat.update).not.toHaveBeenCalled()
  })

  it('чат не записал новый аватар — убирается новый файл, прежний цел', async () => {
    const { service, prisma, files } = avatarSetup()
    files.upload.mockResolvedValue({ id: 'new-file', key: 'new.png' })
    prisma.chat.update.mockRejectedValue(new Error('db down'))

    await expect(service.setChatAvatar(user('u1'), 'c1', Buffer.from('png'))).rejects.toThrow(
      'db down',
    )

    expect(files.delete).toHaveBeenCalledTimes(1)
    expect(files.delete).toHaveBeenCalledWith('new-file')
  })
})
