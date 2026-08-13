import { Role } from '@studenthub/shared-types'
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
    file: { create: jest.fn(), findFirst: jest.fn() },
    chat: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      // По умолчанию — GROUP без участников: проверка личной блокировки завершается сразу.
      findUnique: jest.fn().mockResolvedValue({ type: 'GROUP', members: [] }),
      create: jest.fn(),
      update: jest.fn(),
    },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    pair: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const realtime = {
    emitToRoom: jest.fn(),
    emitToUser: jest.fn(),
    onlineAmong: jest.fn().mockReturnValue([]),
    usersInRoom: jest.fn().mockResolvedValue(new Set<string>()),
  }
  const files = {
    upload: jest.fn(),
    getPresignedUrl: jest.fn(),
    findOrThrow: jest.fn(),
    copyToMessage: jest.fn(),
  }
  const posts = { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('chat-media') }
  // set→'OK' = флаг захвачен, провижининг официальных чатов выполняется (как до троттлинга).
  const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) }
  const service = new ChatsService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    realtime as unknown as RealtimeGateway,
    files as unknown as FileService,
    posts as unknown as PostsService,
    config as unknown as ConfigService<EnvVars, true>,
    redis as never,
  )
  return { service, prisma, queue, realtime, files, posts, config, redis }
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
    prisma.chatMember.findUnique.mockResolvedValueOnce({ id: 'm1' })
    expect(await service.isMember('u1', 'c1')).toBe(true)
    prisma.chatMember.findUnique.mockResolvedValueOnce(null)
    expect(await service.isMember('u1', 'c2')).toBe(false)
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
    prisma.message.findFirst.mockResolvedValue({ id: 'm1', senderId: 'u1', createdAt: new Date() })
    prisma.message.update.mockResolvedValue({ id: 'm1', content: 'x' })
    const res = await service.editMessage('u1', 'm1', 'x')
    expect(res.id).toBe('m1')
    expect(prisma.message.update).toHaveBeenCalled()
  })

  it('правка своего старого сообщения (>10 мин) → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({
      id: 'm1',
      senderId: 'u1',
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    })
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

  it('без chatId → ограничивает чатами участника (без проверки конкретного членства)', async () => {
    const { service, prisma } = setup()
    prisma.message.findMany.mockResolvedValue([])
    await service.searchMessages(user('u1'), { limit: 20, q: 'тест' })
    expect(prisma.chatMember.findUnique).not.toHaveBeenCalled()
    const where = prisma.message.findMany.mock.calls[0][0].where
    expect(where.chat).toEqual({ members: { some: { userId: 'u1' } } })
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
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: 'm1' })
    prisma.message.findUnique.mockResolvedValue({ chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue(null)
    const err = await service.getAttachmentUrl('u1', 'f1').catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('участник → выдаёт presigned URL', async () => {
    const { service, prisma, files } = setup()
    files.findOrThrow.mockResolvedValue({ id: 'f1', messageId: 'm1' })
    prisma.message.findUnique.mockResolvedValue({ chatId: 'c1' })
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    files.getPresignedUrl.mockResolvedValue('https://minio/url')
    expect(await service.getAttachmentUrl('u1', 'f1')).toBe('https://minio/url')
  })
})

describe('ChatsService.sendMessageRest — сообщение с вложениями', () => {
  it('пустой текст без файлов → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'm1' })
    const err = await service
      .sendMessageRest('u1', { chatId: 'c1', content: '  ' }, [])
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.message.create).not.toHaveBeenCalled()
  })

  it('файлы загружаются с messageId и message:new эмитится один раз', async () => {
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
    expect(files.upload.mock.calls[0][0].messageId).toBe('msg1')
    expect(files.upload.mock.calls[0][0].bucket).toBe('chat-media')
    expect(realtime.emitToRoom).toHaveBeenCalledTimes(1)
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', expect.anything())
    expect(res.id).toBe('msg1')
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
    expect(prisma.messageReaction.delete).toHaveBeenCalledWith({ where: { id: 'r1' } })
    expect(prisma.messageReaction.create).not.toHaveBeenCalled()
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
    const res = await service.forwardMessage('u1', 'c1', 'src')
    expect(prisma.message.create.mock.calls[0][0].data.forwardedFromId).toBe('src')
    expect(files.copyToMessage).toHaveBeenCalledTimes(1)
    expect(files.copyToMessage.mock.calls[0][2]).toBe('fwd1')
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:c1', 'message:new', expect.anything())
    expect(res.id).toBe('fwd1')
  })

  it('исходное сообщение не найдено → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findFirst.mockResolvedValue(null)
    const err = await service.forwardMessage('u1', 'c1', 'src').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

describe('ChatsService.setMuted / notifyNewMessage', () => {
  it('mute=true проставляет mutedAt', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.updateMany.mockResolvedValue({ count: 1 })
    const res = await service.setMuted('u1', 'c1', true)
    expect(prisma.chatMember.updateMany.mock.calls[0][0].data.mutedAt).toBeInstanceOf(Date)
    expect(res).toEqual({ chatId: 'c1', muted: true })
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
})

describe('ChatsService.getPresence', () => {
  it('возвращает онлайн-статус участников по realtime.onlineAmong', async () => {
    const { service, prisma, realtime } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.chatMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    realtime.onlineAmong.mockReturnValue(['u2'])
    const res = await service.getPresence('u1', 'c1')
    expect(res).toEqual([
      { userId: 'u1', online: false },
      { userId: 'u2', online: true },
    ])
  })
})

describe('ChatsService.deleteOrLeaveChat', () => {
  it('PRIVATE: прячет чат у себя (hiddenAt + clearedAt), не удаляя членство', async () => {
    const { service, prisma } = setup()
    prisma.chat.findUnique.mockResolvedValue({
      id: 'c1',
      type: 'PRIVATE',
      createdById: 'u2',
      members: [{ userId: 'u1' }, { userId: 'u2' }],
    })
    const res = await service.deleteOrLeaveChat(
      { sub: 'u1' } as Parameters<typeof service.deleteOrLeaveChat>[0],
      'c1',
    )
    const args = prisma.chatMember.updateMany.mock.calls[0][0]
    expect(args.where).toEqual({ chatId: 'c1', userId: 'u1' })
    expect(args.data.hiddenAt).toBeInstanceOf(Date)
    expect(prisma.chatMember.deleteMany).not.toHaveBeenCalled()
    expect(res).toEqual({ chatId: 'c1', deleted: false })
  })
})

describe('ChatsService.exportMessages', () => {
  it('участник → сообщения хронологически (asc), с cap', async () => {
    const { service, prisma } = setup()
    prisma.chatMember.findUnique.mockResolvedValue({ id: 'mem1' })
    prisma.message.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    const res = await service.exportMessages('u1', 'c1')
    expect(res).toHaveLength(2)
    const args = prisma.message.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
    expect(args.take).toBe(5000)
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
})
