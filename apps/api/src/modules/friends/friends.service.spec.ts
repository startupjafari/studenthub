import { Role } from '@studenthub/shared-types'
import { FriendsService } from './friends.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type Redis from 'ioredis'

function setup() {
  const prisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    friendship: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    userBlock: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // advisory-лок пары
    $executeRaw: jest.fn().mockResolvedValue(1),
    // Интерактивная транзакция получает тот же мок клиентом; массивная — Promise.all.
    $transaction: jest.fn((arg: unknown): Promise<unknown> => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(prisma)
      return Promise.all(arg as Promise<unknown>[])
    }),
  }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const redis = {
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue('OK'),
  }
  const service = new FriendsService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    redis as unknown as Redis,
  )
  return { service, prisma, queue, redis }
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
    expect(prisma.friendship.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'PENDING' },
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

describe('FriendsService.sendRequest — кому нельзя', () => {
  it('работодатель заявок не шлёт', async () => {
    const { service, prisma } = setup()
    await expect(service.sendRequest({ ...me, role: Role.EMPLOYER }, 'u2')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(prisma.friendship.create).not.toHaveBeenCalled()
  })

  it('при личной блокировке в любую сторону заявка не уходит', async () => {
    const { service, prisma, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'u2' })
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' })
    await expect(service.sendRequest(me, 'u2')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.friendship.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('работодателя и заблокированного платформой цель не находит', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    await service.sendRequest(me, 'u2').catch(() => undefined)
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isBlocked: false, role: { not: Role.EMPLOYER } }),
      }),
    )
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
    expect(prisma.friendship.updateMany).toHaveBeenCalledWith({
      where: { id: 'f1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'ACCEPTED' }),
    })
    // Принятие идёт под локом пары, а строка — та же: дублем она себя не считает.
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.friendship.delete).not.toHaveBeenCalled()
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

  // Висящая заявка от заблокированного превращалась в дружбу, а дружба открывает закрытый профиль.
  it('принять заявку при личной блокировке в любую сторону → FORBIDDEN, дружбы нет', async () => {
    const { service, prisma, queue } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'me',
      status: 'PENDING',
    })
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' })
    await expect(service.accept(me, 'f1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.userBlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockerId: 'me', blockedId: 'a' },
            { blockerId: 'a', blockedId: 'me' },
          ],
        },
      }),
    )
    expect(prisma.friendship.updateMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
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

// Блокировка сама удаляет дружбу, но пары, заблокированные до этого, остались друзьями в базе.
describe('FriendsService — заблокированные не в списках и счётчиках', () => {
  it('без блокировок фильтр не добавляется', async () => {
    const { service, prisma } = setup()
    await service.listFriends(me, { limit: 20 })
    expect(prisma.friendship.findMany.mock.calls[0][0].where).not.toHaveProperty('AND')
  })

  it('список друзей, заявки и счётчики исключают заблокированных в обе стороны', async () => {
    const { service, prisma } = setup()
    prisma.userBlock.findMany.mockResolvedValue([
      { blockerId: 'me', blockedId: 'ex' },
      { blockerId: 'troll', blockedId: 'me' },
    ])
    const excluded = {
      AND: [
        { requesterId: { notIn: ['ex', 'troll'] } },
        { addresseeId: { notIn: ['ex', 'troll'] } },
      ],
    }
    await service.listFriends(me, { limit: 20 })
    expect(prisma.friendship.findMany.mock.calls[0][0].where).toMatchObject(excluded)

    await service.listRequests(me, { direction: 'outgoing', limit: 20 })
    // Фильтр не затирает собственное условие запроса («мои исходящие»).
    expect(prisma.friendship.findMany.mock.calls[1][0].where).toMatchObject({
      status: 'PENDING',
      requesterId: 'me',
      ...excluded,
    })

    await service.counts(me)
    for (const [arg] of prisma.friendship.count.mock.calls) {
      expect(arg.where).toMatchObject(excluded)
    }
    expect(prisma.friendship.count.mock.calls[1][0].where.addresseeId).toBe('me')
  })
})

// E-F20: встречные заявки одновременно, мёртвые аккаунты в списках, пауза после отклонения.
describe('FriendsService — встречные заявки под локом пары', () => {
  it('поиск связи и запись — в транзакции под локом пары; встречная → принятие', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'target',
      addresseeId: 'me',
      status: 'PENDING',
    })
    const order: string[] = []
    prisma.$executeRaw.mockImplementation(async () => {
      order.push('lock')
      return 1
    })
    prisma.friendship.findFirst.mockImplementation(async () => {
      order.push('find')
      return { id: 'f1', requesterId: 'target', addresseeId: 'me', status: 'PENDING' }
    })
    expect(await service.sendRequest(me, 'target')).toEqual({ status: 'accepted' })
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function))
    expect(order).toEqual(['lock', 'find'])
    // Ключ лока не зависит от направления: «me» и «target» в порядке сортировки.
    const [, key] = prisma.$executeRaw.mock.calls[0] as [unknown, string]
    expect(key).toBe('friendship:me:target')
    expect(prisma.friendship.create).not.toHaveBeenCalled()
  })

  it('ключ лока одинаков для A→B и B→A', async () => {
    const a = setup()
    a.prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    a.prisma.friendship.findFirst.mockResolvedValue(null)
    a.prisma.friendship.create.mockResolvedValue({ id: 'f1' })
    await a.service.sendRequest(me, 'target')
    const b = setup()
    b.prisma.user.findFirst.mockResolvedValue({ id: 'me' })
    b.prisma.friendship.findFirst.mockResolvedValue(null)
    b.prisma.friendship.create.mockResolvedValue({ id: 'f2' })
    await b.service.sendRequest({ ...me, sub: 'target' }, 'me')
    expect(a.prisma.$executeRaw.mock.calls[0][1]).toBe(b.prisma.$executeRaw.mock.calls[0][1])
  })

  it('связь ищется детерминированно: принятая главнее, из заявок — ранняя', async () => {
    const { service, prisma } = setup()
    prisma.friendship.findFirst.mockResolvedValue(null)
    await service.statusFor('me', 'x')
    expect(prisma.friendship.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ status: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    )
  })

  it('принятие встречной удаляет дубль пары и гасит его уведомление', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'target',
      addresseeId: 'me',
      status: 'PENDING',
    })
    // Моя же старая заявка той же паре — след гонки до лока.
    prisma.friendship.findUnique.mockResolvedValue({ id: 'dup' })
    await service.sendRequest(me, 'target')
    expect(prisma.friendship.findUnique).toHaveBeenCalledWith({
      where: { requesterId_addresseeId: { requesterId: 'me', addresseeId: 'target' } },
      select: { id: true },
    })
    expect(prisma.friendship.delete).toHaveBeenCalledWith({ where: { id: 'dup' } })
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'friend-request:dup' },
    })
  })

  it('заявку успели обработать (UPDATE не задел строк) → CONFLICT, уведомлений нет', async () => {
    const { service, prisma, queue } = setup()
    prisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      requesterId: 'a',
      addresseeId: 'me',
      status: 'PENDING',
    })
    prisma.friendship.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.accept(me, 'f1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('FriendsService — удалённые и заблокированные платформой не в списках', () => {
  const active = { deletedAt: null, isBlocked: false }

  it('друзья: условие на второго участника стоит в where (до take)', async () => {
    const { service, prisma } = setup()
    await service.listFriends(me, { limit: 20 })
    expect(prisma.friendship.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'ACCEPTED',
      OR: [
        { requesterId: 'me', addressee: active },
        { addresseeId: 'me', requester: active },
      ],
    })
  })

  it('заявки: входящие — живой отправитель, исходящие — живой адресат', async () => {
    const { service, prisma } = setup()
    await service.listRequests(me, { direction: 'incoming', limit: 20 })
    await service.listRequests(me, { direction: 'outgoing', limit: 20 })
    expect(prisma.friendship.findMany.mock.calls[0][0].where).toMatchObject({
      addresseeId: 'me',
      requester: active,
    })
    expect(prisma.friendship.findMany.mock.calls[1][0].where).toMatchObject({
      requesterId: 'me',
      addressee: active,
    })
  })

  it('счётчики считают только живых', async () => {
    const { service, prisma } = setup()
    await service.counts(me)
    expect(prisma.friendship.count.mock.calls[0][0].where).toMatchObject({
      OR: [
        { requesterId: 'me', addressee: active },
        { addresseeId: 'me', requester: active },
      ],
    })
    expect(prisma.friendship.count.mock.calls[1][0].where).toMatchObject({
      addresseeId: 'me',
      requester: active,
    })
  })
})

describe('FriendsService — пауза на повторную заявку после отклонения', () => {
  const pending = { id: 'f1', requesterId: 'a', addresseeId: 'me', status: 'PENDING' }

  it('адресат отклоняет → ключ паузы на неделю для пары requester→addressee', async () => {
    const { service, prisma, redis } = setup()
    prisma.friendship.findUnique.mockResolvedValue(pending)
    await service.remove(me, 'f1')
    expect(redis.set).toHaveBeenCalledWith('friend-declined:a:me', '1', 'EX', 7 * 24 * 60 * 60)
  })

  it('отмена своей заявки и удаление из друзей паузы не ставят', async () => {
    const { service, prisma, redis } = setup()
    prisma.friendship.findUnique.mockResolvedValueOnce({
      ...pending,
      requesterId: 'me',
      addresseeId: 'b',
    })
    await service.remove(me, 'f1')
    prisma.friendship.findUnique.mockResolvedValueOnce({ ...pending, status: 'ACCEPTED' })
    await service.remove(me, 'f1')
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('во время паузы новая заявка → CONFLICT, строка не создаётся', async () => {
    const { service, prisma, redis, queue } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue(null)
    redis.exists.mockResolvedValue(1)
    await expect(service.sendRequest(me, 'target')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(redis.exists).toHaveBeenCalledWith('friend-declined:me:target')
    expect(prisma.friendship.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('пауза не мешает принять встречную заявку', async () => {
    const { service, prisma, redis } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue({
      id: 'f1',
      requesterId: 'target',
      addresseeId: 'me',
      status: 'PENDING',
    })
    redis.exists.mockResolvedValue(1)
    expect(await service.sendRequest(me, 'target')).toEqual({ status: 'accepted' })
  })

  it('Redis недоступен: заявка уходит, отклонение проходит', async () => {
    const { service, prisma, redis } = setup()
    redis.exists.mockRejectedValue(new Error('ECONNREFUSED'))
    redis.set.mockRejectedValue(new Error('ECONNREFUSED'))
    prisma.user.findFirst.mockResolvedValue({ id: 'target' })
    prisma.friendship.findFirst.mockResolvedValue(null)
    prisma.friendship.create.mockResolvedValue({ id: 'f9' })
    expect(await service.sendRequest(me, 'target')).toEqual({ status: 'pending' })

    prisma.friendship.findUnique.mockResolvedValue(pending)
    await expect(service.remove(me, 'f1')).resolves.toBeUndefined()
    expect(prisma.friendship.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
  })
})
