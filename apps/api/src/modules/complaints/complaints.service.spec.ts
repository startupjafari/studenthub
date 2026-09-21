import { Role } from '@studenthub/shared-types'
import { ComplaintsService } from './complaints.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { UserService } from '../users/users.service'
import type { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
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
    chat: { findFirst: jest.fn() },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const users = {
    setBlocked: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue({ total: 1 }),
  }
  const telegram = { notifyStaff: jest.fn().mockResolvedValue(undefined) }
  const service = new ComplaintsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    users as unknown as UserService,
    telegram as unknown as TelegramNotifyService,
  )
  return { service, prisma, audit, queue, users, telegram }
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

describe('ComplaintsService — приоритет и сортировка очереди', () => {
  async function orderFor(query: Record<string, unknown>) {
    const { service, prisma } = setup()
    await service.list(user(Role.PLATFORM_MODERATOR), { page: 1, limit: 20, ...query } as never)
    return prisma.complaint.findMany.mock.calls[0][0].orderBy
  }

  // Приоритет выводится из категории цели и пишется при создании — клиент его не присылает.
  it('жалоба на пользователя создаётся с высоким приоритетом', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue({ id: 'u9', universityId: 'uni1' })
    await service.create(
      user(Role.STUDENT),
      { targetType: 'USER', targetId: 'u9', reason: 'травля' },
      ctx,
    )
    expect(prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: 'HIGH' }) }),
    )
  })

  it('жалоба на комментарий — низкий приоритет, на пост — средний', async () => {
    const c = setup()
    c.prisma.comment.findFirst.mockResolvedValue({
      authorId: 'a1',
      post: { universityId: 'uni1' },
      author: { universityId: 'uni1' },
    })
    await c.service.create(
      user(Role.STUDENT),
      { targetType: 'COMMENT', targetId: 'cm1', reason: 'x' },
      ctx,
    )
    expect(c.prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: 'LOW' }) }),
    )

    const p = setup()
    p.prisma.post.findFirst.mockResolvedValue({
      authorId: 'a1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    await p.service.create(
      user(Role.STUDENT),
      { targetType: 'POST', targetId: 'p1', reason: 'x' },
      ctx,
    )
    expect(p.prisma.complaint.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priority: 'MEDIUM' }) }),
    )
  })

  // Порядок по умолчанию и есть очередь: необработанные → HIGH раньше LOW → свежие раньше.
  it('без sort очередь идёт по статусу, приоритету и дате', async () => {
    expect(await orderFor({})).toEqual([
      { status: 'asc' },
      { priority: 'asc' },
      { createdAt: 'desc' },
    ])
  })

  it('sort=priority с order=desc разворачивает приоритет, дата остаётся второй ступенью', async () => {
    expect(await orderFor({ sort: 'priority', order: 'desc' })).toEqual([
      { priority: 'desc' },
      { createdAt: 'desc' },
    ])
  })

  it('неизвестное поле сортировки не попадает в orderBy', async () => {
    expect(await orderFor({ sort: 'resolution', order: 'desc' })).toEqual([
      { status: 'asc' },
      { priority: 'asc' },
      { createdAt: 'desc' },
    ])
  })

  it('фильтр по приоритету сужает выборку', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.PLATFORM_MODERATOR), {
      page: 1,
      limit: 20,
      priority: 'HIGH',
    } as never)
    expect(prisma.complaint.findMany.mock.calls[0][0].where.priority).toBe('HIGH')
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

  // Блокируют человека, а в жалобе на пост видно только пост: владельца цели сервер
  // разрешает сам, иначе мини-апп показывал бы карточку «неизвестно кого».
  it('отдаёт владельца цели: по жалобе на пост — его автора', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    const card = await service.getById(user(Role.PLATFORM_ADMIN), 'c1')
    expect(card.targetOwnerId).toBe('author1')
  })

  // Снесённый пост — обычное дело: его могли удалить до разбора. Карточка обязана
  // открыться и без владельца, иначе жалобу нельзя ни отклонить, ни закрыть.
  it('у снесённой цели владельца нет, но карточка открывается', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue(null)
    const card = await service.getById(user(Role.PLATFORM_ADMIN), 'c1')
    expect(card.targetOwnerId).toBeNull()
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

  // Промежуточная мера: до неё шкала шла от «нарушения нет» сразу к блокировке.
  it('WARN_USER → предупреждение автору, доступ не трогаем', async () => {
    const { service, prisma, users } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'RESOLVED' }))

    await service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx)
    expect(users.warn).toHaveBeenCalledWith(admin, 'author1', 'c1')
    expect(users.setBlocked).not.toHaveBeenCalled()
    expect(prisma.complaint.update.mock.calls[0][0].data.status).toBe('RESOLVED')
  })

  // Срок считается от решения: «на семь дней», выданное вечером, кончается вечером.
  it('BLOCK_USER со сроком передаёт дату снятия', async () => {
    const { service, prisma, users } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'RESOLVED' }))

    await service.resolve(admin, 'c1', { action: 'BLOCK_USER', blockDays: 7 }, ctx)
    const until = users.setBlocked.mock.calls[0][3] as Date
    const days = Math.round((until.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    expect(days).toBe(7)
  })

  it('BLOCK_USER без срока блокирует бессрочно', async () => {
    const { service, prisma, users } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    prisma.complaint.update.mockResolvedValue(complaint({ status: 'RESOLVED' }))

    await service.resolve(admin, 'c1', { action: 'BLOCK_USER' }, ctx)
    expect(users.setBlocked.mock.calls[0][3]).toBeNull()
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

describe('ComplaintsService.create — уведомление команды платформы', () => {
  // Жалоба на человека и на личные сообщения = кто-то страдает прямо сейчас,
  // и ждать, пока модератор сам откроет очередь, не стоит.
  it('сообщает в Telegram о срочной жалобе', async () => {
    const { service, prisma, telegram } = setup()
    prisma.complaint.create.mockResolvedValue({
      id: 'c-1',
      priority: 'HIGH',
      targetType: 'USER',
    })
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', universityId: 'uni-1' })

    await service.create(
      user(Role.STUDENT),
      { targetType: 'USER', targetId: 'u2', reason: 'травля' },
      ctx,
    )

    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'complaint',
      'Срочная жалоба на пользователя',
      'complaint_c-1',
    )
  })

  // Иначе уведомления обесценятся, и первыми перестанут читать как раз срочные.
  it('о несрочной жалобе молчит — она ждёт в очереди', async () => {
    const { service, prisma, telegram } = setup()
    prisma.complaint.create.mockResolvedValue({
      id: 'c-2',
      priority: 'MEDIUM',
      targetType: 'POST',
    })
    prisma.post.findFirst.mockResolvedValue({ id: 'p1', universityId: 'uni-1' })

    await service.create(
      user(Role.STUDENT),
      { targetType: 'POST', targetId: 'p1', reason: 'спам' },
      ctx,
    )

    expect(telegram.notifyStaff).not.toHaveBeenCalled()
  })
})

describe('ComplaintsService.reopen', () => {
  it('возвращает разобранную жалобу в очередь и стирает решение', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue({
      id: 'c-1',
      status: 'RESOLVED',
      targetType: 'POST',
      targetId: 'p1',
      universityId: null,
    })

    await service.reopen(user(Role.PLATFORM_ADMIN), 'c-1', ctx)

    expect(prisma.complaint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          resolvedById: null,
          resolvedAt: null,
          resolution: null,
        }),
      }),
    )
  })

  it('не возвращает то, что и так в очереди', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue({
      id: 'c-1',
      status: 'PENDING',
      targetType: 'POST',
      targetId: 'p1',
      universityId: null,
    })

    await expect(service.reopen(user(Role.PLATFORM_ADMIN), 'c-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})

// ── Жалоба из обращения в поддержку (пункт 34) ──────────────────────────────
describe('ComplaintsService.createFromSupport', () => {
  const staff = user(Role.PLATFORM_ADMIN)

  function ticket(over: Record<string, unknown> = {}) {
    return {
      id: 'chat1',
      members: [
        { user: { id: 'author1', role: Role.STUDENT } },
        { user: { id: 'mod1', role: Role.PLATFORM_MODERATOR } },
      ],
      messages: [{ content: 'Иванов пишет мне угрозы' }],
      ...over,
    }
  }

  // Жаловался автор обращения. Если записать жалобу на поддержку, окажется, что половину
  // жалоб на платформе подаёт она сама.
  it('автором жалобы остаётся автор обращения, а не модератор', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(ticket())
    prisma.user.findFirst.mockResolvedValue({ id: 'target1', universityId: 'uni1' })
    prisma.complaint.create.mockResolvedValue(complaint({ targetType: 'USER' }))

    await service.createFromSupport(staff, 'chat1', 'target1', ctx)
    expect(prisma.complaint.create.mock.calls[0][0].data).toMatchObject({
      reporterId: 'author1',
      targetType: 'USER',
      targetId: 'target1',
    })
  })

  // Текст жалобы — собственные слова человека, а не пересказ поддержки.
  it('берёт текст из первого сообщения обращения', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(ticket())
    prisma.user.findFirst.mockResolvedValue({ id: 'target1', universityId: 'uni1' })
    prisma.complaint.create.mockResolvedValue(complaint())

    await service.createFromSupport(staff, 'chat1', 'target1', ctx)
    expect(prisma.complaint.create.mock.calls[0][0].data.reason).toBe('Иванов пишет мне угрозы')
  })

  it('обращение без автора → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(
      ticket({ members: [{ user: { id: 'mod1', role: Role.PLATFORM_ADMIN } }] }),
    )
    const err = await service.createFromSupport(staff, 'chat1', 'target1', ctx).catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('жалоба на самого автора → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.chat.findFirst.mockResolvedValue(ticket())
    const err = await service.createFromSupport(staff, 'chat1', 'author1', ctx).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })
})
