import { Role } from '@studenthub/shared-types'
import { FriendsService } from './friends.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function setup() {
  const prisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    friendship: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new FriendsService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
  )
  return { service, prisma, queue }
}

const me: JwtPayload = {
  sub: 'me',
  role: Role.STUDENT,
  universityId: null,
  facultyId: null,
  groupId: null,
}

describe('FriendsService.sendRequest', () => {
  it('сам себе → BAD_REQUEST', async () => {
    const { service } = setup()
    await expect(service.sendRequest(me, 'me')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('цель не найдена → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await expect(service.sendRequest(me, 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('нет связи → создаёт заявку и шлёт уведомление FRIEND_REQUEST', async () => {
    const { service, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue(null)
    prisma.friendship.create.mockResolvedValue({ id: 'f1' })
    const res = await service.sendRequest(me, 'target')
    expect(res).toEqual({ status: 'pending' })
    expect(prisma.friendship.create).toHaveBeenCalledWith({
      data: { requesterId: 'me', addresseeId: 'target' },
      select: { id: true },
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'friend-request',
      expect.objectContaining({
        recipientIds: ['target'],
        type: 'SYSTEM',
        // actionable-данные для кнопок принять/отклонить в уведомлении.
        data: expect.objectContaining({ kind: 'friend-request', friendshipId: 'f1' }),
      }),
      expect.anything(),
    )
  })

  it('встречная заявка (адресат — я) → авто-принятие', async () => {
    const { service, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'target',
      addresseeId: 'me',
      status: 'PENDING',
    })
    const res = await service.sendRequest(me, 'target')
    expect(res).toEqual({ status: 'accepted' })
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'friend-accepted',
      expect.objectContaining({ recipientIds: ['target'] }),
      expect.anything(),
    )
  })

  it('исходящая заявка уже есть → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'me',
      addresseeId: 'target',
      status: 'PENDING',
    })
    await expect(service.sendRequest(me, 'target')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('уже друзья → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'target',
      addresseeId: 'me',
      status: 'ACCEPTED',
    })
    await expect(service.sendRequest(me, 'target')).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('FriendsService.accept / remove', () => {
  it('принять чужую (я не адресат) → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'b',
      status: 'PENDING',
    })
    await expect(service.accept(me, 'f1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('принять уже принятую → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'me',
      status: 'ACCEPTED',
    })
    await expect(service.accept(me, 'f1')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('принять входящую → ACCEPTED + уведомление отправителю', async () => {
    const { service, prisma, queue } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'me',
      status: 'PENDING',
    })
    await service.accept(me, 'f1')
    expect(prisma.friendship.update).toHaveBeenCalledWith({
      where: { id: 'f1' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'friend-accepted',
      expect.objectContaining({ recipientIds: ['a'] }),
      expect.anything(),
    )
    // Уведомление-заявку у принявшего гасим.
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'friend-request:f1' },
    })
  })

  it('отклонение/отмена (remove) — гасит уведомление и НЕ шлёт ничего отправителю', async () => {
    const { service, prisma, queue } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'me',
    })
    await service.remove(me, 'f1')
    expect(prisma.friendship.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'friend-request:f1' },
    })
    // Отправителю ничего не уходит.
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('удалить связь, где я не участник → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findUnique.mockResolvedValue({ id: 'f1', requesterId: 'a', addresseeId: 'b' })
    await expect(service.remove(me, 'f1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.friendship.delete).not.toHaveBeenCalled()
  })
})

describe('FriendsService.statusFor', () => {
  it('сам с собой → NONE', async () => {
    const { service } = setup()
    expect(await service.statusFor('me', 'me')).toEqual({ status: 'NONE' })
  })

  it('нет связи → NONE', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findFirst.mockResolvedValue(null)
    expect(await service.statusFor('me', 'x')).toEqual({ status: 'NONE' })
  })

  it('принятая → ACCEPTED + id', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'x',
      addresseeId: 'me',
      status: 'ACCEPTED',
    })
    expect(await service.statusFor('me', 'x')).toEqual({ status: 'ACCEPTED', friendshipId: 'f1' })
  })

  it('исходящая → PENDING_OUTGOING; входящая → PENDING_INCOMING', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findFirst.mockResolvedValueOnce({
      id: 'f1',
      requesterId: 'me',
      addresseeId: 'x',
      status: 'PENDING',
    })
    expect(await service.statusFor('me', 'x')).toEqual({
      status: 'PENDING_OUTGOING',
      friendshipId: 'f1',
    })
    prisma.friendship.findFirst.mockResolvedValueOnce({
      id: 'f2',
      requesterId: 'x',
      addresseeId: 'me',
      status: 'PENDING',
    })
    expect(await service.statusFor('me', 'x')).toEqual({
      status: 'PENDING_INCOMING',
      friendshipId: 'f2',
    })
  })
})
