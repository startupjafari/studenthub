import { Role } from '@studenthub/shared-types'
import { COMPLAINT_REPORTER_ROLES, canFileComplaint } from '@studenthub/shared-schemas'
import { ComplaintsService } from './complaints.service'
import { ComplaintsController } from './complaints.controller'
import { ROLES_KEY } from '../../common/decorators/roles.decorator'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { UserService } from '../users/users.service'
import type { StoriesService } from '../stories/stories.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { PostsService } from '../posts/posts.service'
import type { TelegramNotifyService } from '../../common/telegram/telegram-notify.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    complaint: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      // Самая старая жалоба в очереди: её возраст идёт в сводку.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      // Разные авторы жалоб на цель (getById).
      groupBy: jest.fn().mockResolvedValue([]),
    },
    // findUnique — текст цели для карточки разбора (getById → targetPreview).
    post: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    story: { findFirst: jest.fn(), findUnique: jest.fn() },
    comment: { findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    chatMember: { findFirst: jest.fn().mockResolvedValue({ id: 'member' }) },
    message: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    chat: { findFirst: jest.fn() },
    // advisory-лок «автор + цель» при создании жалобы (advisoryXactLock → $executeRaw).
    $executeRaw: jest.fn().mockResolvedValue(0),
    // Обе формы: массив запросов и колбэк (в колбэк приходит тот же мок как транзакция).
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const users = {
    setBlocked: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue({ total: 1 }),
  }
  const telegram = { notifyStaff: jest.fn().mockResolvedValue(undefined) }
  // Сторис сносит владелец домена: мягкого удаления у неё нет (Ф14.1).
  const stories = {
    removeByModeration: jest.fn().mockResolvedValue(undefined),
    assertVisibleToViewer: jest.fn().mockResolvedValue(undefined),
  }
  const realtime = { emitToRoom: jest.fn() }
  // Видимость цели автору жалобы — правило владельца домена постов.
  const posts = { assertVisibleToViewer: jest.fn().mockResolvedValue(undefined) }
  const service = new ComplaintsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    users as unknown as UserService,
    telegram as unknown as TelegramNotifyService,
    stories as unknown as StoriesService,
    realtime as unknown as RealtimeGateway,
    posts as unknown as PostsService,
  )
  return { service, prisma, audit, queue, users, telegram, stories, realtime, posts }
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
  it('истёкшая сторис → NOT_FOUND (разбирать нечего, контента уже нет)', async () => {
    const { service, prisma } = setup()
    prisma.story.findFirst.mockResolvedValue(null)
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'STORY', targetId: 's1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('NOT_FOUND')
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

// Невидимое автору жалобы — то же, что несуществующее: жалоба не подтверждает чужой id.
describe('ComplaintsService.create — видимость цели', () => {
  it('пост вне видимости → NOT_FOUND, жалоба не создаётся', async () => {
    const { service, prisma, posts } = setup()
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'a1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    posts.assertVisibleToViewer.mockRejectedValue(new AppException('NOT_FOUND', 'Пост не найден'))
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'POST', targetId: 'p1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Пост не найден')
    expect(prisma.complaint.create).not.toHaveBeenCalled()
  })

  it('комментарий к невидимому посту → NOT_FOUND про комментарий', async () => {
    const { service, prisma, posts } = setup()
    prisma.comment.findFirst
      .mockResolvedValueOnce({ authorId: 'a1', author: { universityId: 'uni1' } })
      .mockResolvedValueOnce({ postId: 'p9' })
    posts.assertVisibleToViewer.mockRejectedValue(new AppException('NOT_FOUND', 'Пост не найден'))
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'COMMENT', targetId: 'cm1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(posts.assertVisibleToViewer).toHaveBeenCalledWith(expect.anything(), 'p9')
    expect(err.message).toBe('Комментарий не найден')
  })

  it('сторис вне видимости → NOT_FOUND', async () => {
    const { service, prisma, stories } = setup()
    prisma.story.findFirst.mockResolvedValue({
      authorId: 'a1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    stories.assertVisibleToViewer.mockRejectedValue(
      new AppException('NOT_FOUND', 'Сторис не найдена'),
    )
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'STORY', targetId: 's1', reason: 'x' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.complaint.create).not.toHaveBeenCalled()
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

  // Разбор по содержимому: без текста цели модератор снимал контент вслепую.
  it('отдаёт текст обжалованного поста, и удалённого автором тоже', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findUnique.mockResolvedValue({
      title: 'Заголовок',
      content: 'текст поста',
      deletedAt: new Date(),
      _count: { media: 2 },
    })
    const card = await service.getById(user(Role.PLATFORM_ADMIN), 'c1')
    expect(card.targetPreview).toEqual({
      title: 'Заголовок',
      text: 'текст поста',
      mediaCount: 2,
      deleted: true,
    })
  })

  it('у жалобы на человека превью нет', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'USER' }))
    const card = await service.getById(user(Role.PLATFORM_ADMIN), 'c1')
    expect(card.targetPreview).toBeNull()
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
    await service.resolve(admin, 'c1', { action: 'DISMISS' }, ctx)
    expect(prisma.complaint.updateMany.mock.calls[0][0].data.status).toBe('DISMISSED')
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

    await service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx)
    expect(users.warn).toHaveBeenCalledWith(admin, 'author1', 'c1', ctx)
    expect(users.setBlocked).not.toHaveBeenCalled()
    expect(prisma.complaint.updateMany.mock.calls[0][0].data.status).toBe('RESOLVED')
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

    await service.resolve(admin, 'c1', { action: 'BLOCK_USER' }, ctx)
    expect(users.setBlocked.mock.calls[0][3]).toBeNull()
  })

  it('DELETE_CONTENT (пост) → soft delete поста + RESOLVED', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ targetType: 'POST', targetId: 'p1' }))
    await service.resolve(admin, 'c1', { action: 'DELETE_CONTENT' }, ctx)
    expect(prisma.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
    expect(prisma.complaint.updateMany.mock.calls[0][0].data.status).toBe('RESOLVED')
  })

  // Участники чата видят снятие сразу — тем же событием, что и удаление автором.
  it('DELETE_CONTENT (сообщение) → message:deleted в комнату чата', async () => {
    const { service, prisma, realtime } = setup()
    prisma.complaint.findUnique.mockResolvedValue(
      complaint({ targetType: 'MESSAGE', targetId: 'm1' }),
    )
    prisma.message.findUnique.mockResolvedValue({ chatId: 'chat1' })
    await service.resolve(admin, 'c1', { action: 'DELETE_CONTENT' }, ctx)
    expect(prisma.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' } }),
    )
    expect(realtime.emitToRoom).toHaveBeenCalledWith('chat:chat1', 'message:deleted', {
      messageId: 'm1',
      chatId: 'chat1',
    })
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
    await service.resolve(admin, 'c1', { action: 'BLOCK_USER' }, ctx)
    // Четвёртый аргумент — срок: без него блокировка бессрочная, как была до сроков. Пятый —
    // откуда мера: IP, user-agent и жалоба уходят в журнал блокировки (§11.4).
    expect(users.setBlocked).toHaveBeenCalledWith(admin, 'a1', true, null, {
      ...ctx,
      complaintId: 'c1',
    })
  })

  it('уже обработанную нельзя разрешить повторно → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ status: 'RESOLVED' }))
    const err = await service.resolve(admin, 'c1', { action: 'DISMISS' }, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })

  // Захват жалобы — условная запись ДО меры: статус «в очереди» стоит в самом UPDATE.
  it('решение захватывает жалобу условием на статус и только потом применяет меру', async () => {
    const { service, prisma, users } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    await service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx)
    expect(prisma.complaint.updateMany.mock.calls[0][0].where).toEqual({
      id: 'c1',
      status: { in: ['PENDING', 'REVIEWING'] },
    })
    const [claimedAt] = prisma.complaint.updateMany.mock.invocationCallOrder
    const [warnedAt] = users.warn.mock.invocationCallOrder
    expect(claimedAt).toBeLessThan(warnedAt!)
  })

  // Два одновременных решения (веб + мини-апп, двойной клик): оба прочитали PENDING, но
  // захват достаётся одному. Второе — CONFLICT без второго предупреждения и уведомлений.
  it('повторное решение, проигравшее захват, меру не применяет → CONFLICT', async () => {
    const { service, prisma, users, queue, audit } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    prisma.complaint.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const [first, second] = await Promise.allSettled([
      service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx),
      service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx),
    ])
    expect(first.status).toBe('fulfilled')
    expect(second.status).toBe('rejected')
    expect((second as PromiseRejectedResult).reason.code).toBe('CONFLICT')
    expect(users.warn).toHaveBeenCalledTimes(1)
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledTimes(1)
  })

  // Мера не прошла после захвата (например, scope нарушителя) — жалоба не должна остаться
  // «решённой» без меры: она возвращается в прежнее состояние, ошибка уходит наверх.
  it('мера упала после захвата → жалоба возвращается в очередь', async () => {
    const { service, prisma, users, queue } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ status: 'REVIEWING' }))
    prisma.post.findFirst.mockResolvedValue({
      authorId: 'author1',
      universityId: 'uni1',
      author: { universityId: 'uni1' },
    })
    users.setBlocked.mockRejectedValue(new AppException('FORBIDDEN', 'нельзя'))

    const err = await service.resolve(admin, 'c1', { action: 'BLOCK_USER' }, ctx).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    const rollback = prisma.complaint.updateMany.mock.calls[1][0]
    expect(rollback.where).toMatchObject({ id: 'c1', status: 'RESOLVED', resolvedById: 'u1' })
    expect(rollback.data).toMatchObject({ status: 'REVIEWING', resolvedById: null })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  // Отказ по существу — до захвата: жалоба ни на миг не становится «решённой».
  it('нарушитель не найден → BAD_REQUEST без захвата жалобы', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.post.findFirst.mockResolvedValue(null)
    const err = await service.resolve(admin, 'c1', { action: 'WARN_USER' }, ctx).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.complaint.updateMany).not.toHaveBeenCalled()
  })
})

// Один список для guard'а POST /complaints и пункта «Пожаловаться» в клиентах (D-F27).
describe('COMPLAINT_REPORTER_ROLES', () => {
  it('жалуются студент, староста, преподаватель; сотрудники и работодатель — нет', () => {
    for (const role of [Role.STUDENT, Role.STAROSTA, Role.TEACHER]) {
      expect(canFileComplaint(role)).toBe(true)
    }
    for (const role of [
      Role.DEAN,
      Role.UNIVERSITY_ADMIN,
      Role.UNIVERSITY_MODERATOR,
      Role.PLATFORM_ADMIN,
      Role.PLATFORM_MODERATOR,
      Role.EMPLOYER,
    ]) {
      expect(canFileComplaint(role)).toBe(false)
    }
    expect(canFileComplaint(null)).toBe(false)
  })

  it('guard POST /complaints построен из того же списка', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, ComplaintsController.prototype.create) as Role[]
    expect([...roles].sort()).toEqual([...COMPLAINT_REPORTER_ROLES].sort())
  })
})

describe('ComplaintsService — повторы и дубли (D-F27)', () => {
  const admin = user(Role.UNIVERSITY_ADMIN, { universityId: 'uni1' })
  const post = { authorId: 'a1', universityId: 'uni1', author: { universityId: 'uni1' } }

  it('повторная жалоба того же автора на ту же цель, пока первая в очереди → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.post.findFirst.mockResolvedValue(post)
    prisma.complaint.findFirst.mockResolvedValueOnce({ id: 'c-open' })
    const err = await service
      .create(user(Role.STUDENT), { targetType: 'POST', targetId: 'p1', reason: 'spam' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.complaint.create).not.toHaveBeenCalled()
    // Проверка — под локом «автор + цель» и среди открытых жалоб этого автора.
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.complaint.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reporterId: 'u1',
          targetType: 'POST',
          targetId: 'p1',
          status: { in: ['PENDING', 'REVIEWING'] },
        },
      }),
    )
  })

  it('счётчик жалоб на цель — по разным авторам, а не по строкам', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.complaint.groupBy.mockResolvedValue([{ reporterId: 'r1' }, { reporterId: 'r2' }])
    const result = await service.getById(admin, 'c1')
    expect(result.targetReports).toBe(2)
    expect(prisma.complaint.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['reporterId'], take: expect.any(Number) }),
    )
    expect(prisma.complaint.count).not.toHaveBeenCalled()
  })

  it('закрытие дублей пишет то же решение и уведомляет их авторов по разу', async () => {
    const { service, prisma, queue } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.complaint.findMany
      // Открытые дубли той же цели.
      .mockResolvedValueOnce([
        { id: 'c2', reporterId: 'r2' },
        { id: 'c3', reporterId: 'r2' },
        { id: 'c4', reporterId: 'r1' },
      ])
      // Те, что закрыло именно это решение.
      .mockResolvedValueOnce([
        { id: 'c2', reporterId: 'r2' },
        { id: 'c3', reporterId: 'r2' },
        { id: 'c4', reporterId: 'r1' },
      ])
    prisma.complaint.updateMany
      .mockResolvedValueOnce({ count: 1 }) // захват основной
      .mockResolvedValueOnce({ count: 3 }) // дубли

    await service.resolve(
      admin,
      'c1',
      { action: 'DISMISS', comment: 'нарушения нет', applyToDuplicates: true },
      ctx,
    )

    const dupUpdate = prisma.complaint.updateMany.mock.calls[1][0]
    expect(dupUpdate.where).toEqual({
      id: { in: ['c2', 'c3', 'c4'] },
      status: { in: ['PENDING', 'REVIEWING'] },
    })
    expect(dupUpdate.data).toMatchObject({
      status: 'DISMISSED',
      resolvedById: 'u1',
      resolution: 'нарушения нет',
    })
    // r1 — автор основной жалобы, своё уведомление уже получил; r2 — одно на два дубля.
    const recipients = queue.enqueue.mock.calls.map((c) => c[2].recipientIds)
    expect(recipients).toEqual([['r1'], ['r2']])
    expect(queue.enqueue.mock.calls[1][2]).toMatchObject({
      bodyKey: 'complaints.dismissed.body',
      data: { complaintId: 'c2' },
    })
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
    const at = new Date('2026-10-01T10:00:00Z')
    prisma.message.findUnique.mockResolvedValue({ chatId: 'chat1', createdAt: at })
    await service.getMessageContext(mod, 'c1', ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'moderator_chat_access', entityId: 'chat1' }),
    )
    // Окно вокруг обжалованного сообщения, а не начало чата.
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 'chat1', createdAt: { lte: at } } }),
    )
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chatId: 'chat1', createdAt: { gt: at } } }),
    )
  })

  it('у удалённых соседних сообщений текста нет, у обжалованного — есть', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(
      complaint({ targetType: 'MESSAGE', targetId: 'm1' }),
    )
    const at = new Date('2026-10-01T10:00:00Z')
    prisma.message.findUnique.mockResolvedValue({ chatId: 'chat1', createdAt: at })
    prisma.message.findMany
      .mockResolvedValueOnce([
        { id: 'm1', content: 'угроза', deletedAt: at },
        { id: 'm0', content: 'личное', deletedAt: at },
      ])
      .mockResolvedValueOnce([])
    const rows = (await service.getMessageContext(mod, 'c1', ctx)) as Array<{
      id: string
      content: string | null
    }>
    expect(rows.find((r) => r.id === 'm1')?.content).toBe('угроза')
    expect(rows.find((r) => r.id === 'm0')?.content).toBeNull()
  })
})

describe('ComplaintsService.create — жалоба на сообщение', () => {
  it('не участник чата пожаловаться не может — ответ как у несуществующего', async () => {
    const { service, prisma } = setup()
    prisma.message.findFirst.mockResolvedValue({ senderId: 's1', sender: { universityId: 'uni1' } })
    prisma.chatMember.findFirst.mockResolvedValue(null)
    const err = await service
      .create(
        user(Role.STUDENT, { universityId: 'uni1' }),
        {
          targetType: 'MESSAGE',
          targetId: 'm1',
          reason: 'спам',
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.complaint.create).not.toHaveBeenCalled()
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

    // Последние аргументы — кнопка квитирования: уведомление о срочной жалобе уходит
    // всей команде, и без неё двое открывают одну и ту же.
    expect(telegram.notifyStaff).toHaveBeenCalledWith(
      'complaint',
      // Второй строкой — размер очереди: «срочная жалоба» звучит одинаково и когда она
      // одна, и когда она девятая.
      expect.stringContaining('Срочная жалоба на пользователя\nЖалоб в очереди:'),
      'complaint_c-1',
      expect.any(Date),
      false,
      { kind: 'complaint', id: 'c-1' },
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

// ── Квитирование (пункт 91) ─────────────────────────────────────────────────
describe('ComplaintsService.take', () => {
  const admin = user(Role.PLATFORM_ADMIN)

  it('ставит REVIEWING и запоминает, кто взял', async () => {
    const { service, prisma, audit } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    await expect(service.take(admin, 'c1', ctx)).resolves.toEqual({ takenBy: 'u1' })
    // Статус — в условии записи: решение, успевшее между чтением и записью, не
    // возвращается в REVIEWING.
    expect(prisma.complaint.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', reviewingById: null, status: { in: ['PENDING', 'REVIEWING'] } },
      data: { reviewingById: 'u1', status: 'REVIEWING' },
    })
    // «Взял» — действие модератора, в журнале с IP и user-agent, как решение (§11.4).
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'complaint_taken', ip: ctx.ip, userAgent: ctx.userAgent }),
    )
  })

  // Условие `reviewingById: null` стоит в самом запросе: два одновременных «беру» не
  // победят оба, и второй получит отказ, а не тихо перепишет первого.
  it('чужую жалобу перехватить нельзя', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint())
    prisma.complaint.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.take(admin, 'c1').catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('CONFLICT')
  })

  it('разобранную жалобу брать нечего', async () => {
    const { service, prisma } = setup()
    prisma.complaint.findUnique.mockResolvedValue(complaint({ status: 'RESOLVED' }))
    const err = await service.take(admin, 'c1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
  })
})
