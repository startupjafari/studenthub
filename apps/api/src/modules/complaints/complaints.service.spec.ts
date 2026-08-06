import { Role } from '@studenthub/shared-types'
import { ComplaintsService } from './complaints.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { UserService } from '../users/users.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    complaint: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    post: { findFirst: jest.fn(), updateMany: jest.fn() },
    comment: { findFirst: jest.fn(), updateMany: jest.fn() },
    message: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const users = { setBlocked: jest.fn().mockResolvedValue(undefined) }
  const service = new ComplaintsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    users as unknown as UserService,
  )
  return { service, prisma, audit, queue, users }
}

const user = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: scope.sub ?? 'u1',
  role,
  universityId: scope.universityId ?? null,
  facultyId: null,
  groupId: null,
})

function complaint(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    targetType: 'POST',
    targetId: 'p1',
    reason: 'spam',
    status: 'PENDING',
    universityId: 'uni1',
    resolution: null,
    resolvedAt: null,
    createdAt: new Date(),
    reporter: { id: 'r1', firstName: 'A', lastName: 'B' },
    resolvedBy: null,
    ...over,
  }
}

describe('ComplaintsService.create (11.2)', () => {
  it('STORY → BAD_REQUEST (пока не поддерживается)', async () => {
    const { service } = setup()
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'STORY', targetId: 's1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('несуществующий пост → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(null)
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'POST', targetId: 'p1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('пост есть → жалоба создаётся с universityId цели', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'a1',
      universityId: 'uni1',
      author: { universityId: 'uni9' },
    })
    await service.create(
      user(Role.STUDENT),
      { targetType: 'POST', targetId: 'p1', reason: 'spam' },
      ctx,
    )
    expect(prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ universityId: 'uni1', targetType: 'POST' }),
      }),
    )
  })
})

describe('ComplaintsService — scope очереди (11.3)', () => {
  it('модератор вуза видит только свой вуз', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.UNIVERSITY_MODERATOR, { universityId: 'uni1' }), {
      page: 1,
      limit: 20,
    })
    expect(prisma.complaint.findMany.mock.calls[0][0].where.universityId).toBe('uni1')
  })

  it('платформенный модератор видит все', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.PLATFORM_MODERATOR), { page: 1, limit: 20 })
    expect(prisma.complaint.findMany.mock.calls[0][0].where.universityId).toBeUndefined()
  })

  it('жалоба чужого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ universityId: 'uniX' }))
    const err = await service
      .getById(user(Role.UNIVERSITY_ADMIN, { universityId: 'uni1' }), 'c1')
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
})

describe('ComplaintsService.resolve (11.4)', () => {
  const admin = user(Role.UNIVERSITY_ADMIN, { universityId: 'uni1' })

  it('DISMISS → статус DISMISSED + уведомление автору', async () => {
    const { service, prisma, queue } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'DISMISSED' }))
    await service.resolve(admin, 'c1', { action: 'DISMISS' }, ctx)
    expect(prisma.complaint.update.mock.calls[0][0].data.status).toBe('DISMISSED')
    expect(queue.enqueue.mock.calls[0][2].recipientIds).toEqual(['r1'])
  })

  it('DELETE_CONTENT (пост) → soft delete поста + RESOLVED', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'POST', targetId: 'p1' }))
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'RESOLVED' }))
    await service.resolve(admin, 'c1', { action: 'DELETE_CONTENT' }, ctx)
    expect(prisma.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
    expect(prisma.complaint.update.mock.calls[0][0].data.status).toBe('RESOLVED')
  })

  it('DELETE_CONTENT на USER → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'USER', targetId: 'u9' }))
    const err = await service
      .resolve(admin, 'c1', { action: 'DELETE_CONTENT' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('BLOCK_USER → блокирует владельца контента через UserService', async () => {
    const { service, prisma, users } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'POST', targetId: 'p1' }))
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'a1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'RESOLVED' }))
    await service.resolve(admin, 'c1', { action: 'BLOCK_USER' }, ctx)
    expect(users.setBlocked).toHaveBeenCalledWith(admin, 'a1', true)
  })

  it('уже обработанную нельзя разрешить повторно → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ status: 'RESOLVED' }))
    const err = await service.resolve(admin, 'c1', { action: 'DISMISS' }, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })
})

describe('ComplaintsService.getMessageContext (11.5)', () => {
  const mod = user(Role.UNIVERSITY_MODERATOR, { universityId: 'uni1' })

  it('жалоба не на сообщение → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'POST' }))
    const err = await service.getMessageContext(mod, 'c1', ctx).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('MESSAGE → пишет moderator_chat_access в аудит и отдаёт сообщения', async () => {
    const { service, prisma, audit } = setup()
    prisma.complaint.findUnique.mockResolvedValue(
      complaint({ targetType: 'MESSAGE', targetId: 'm1' }),
    )
    prisma.message.findUnique.mockResolvedValue({ chatId: 'chat1' })
    await service.getMessageContext(mod, 'c1', ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'moderator_chat_access', entityId: 'chat1' }),
    )
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 'chat1' } }),
    )
  })
})
