import { Role } from '@studenthub/shared-types'
import { PollsService } from './polls.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { UserService } from '../users/users.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { Paginated } from '../../common/http/paginated'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const queueMock = () => ({ enqueue: jest.fn().mockResolvedValue(undefined) })

const voter: JwtPayload = {
  sub: 'u1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

const poll = {
  id: 'p1',
  userId: 'author',
  multiple: false,
  allowRevote: false,
  visibility: 'ALL',
  status: 'PUBLISHED',
  closesAt: null,
  options: [{ id: 'o1' }, { id: 'o2' }],
  user: { id: 'author', universityId: 'uni-1', facultyId: null, groupId: null, deletedAt: null },
}

function setup(existingVotes: number) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    // Опрос, перечитанный голосом под локом.
    poll: { findUnique: jest.fn().mockResolvedValue(poll), update: jest.fn() },
    pollOption: { deleteMany: jest.fn() },
    pollVote: {
      count: jest.fn().mockResolvedValue(existingVotes),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  }
  const prisma = {
    poll: { findUnique: jest.fn().mockResolvedValue(poll) },
    pollVote: { deleteMany: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  // Профиль автора открыт; закрытый — отдельные тесты ниже.
  const users = {
    canViewProfileContent: jest.fn().mockResolvedValue(true),
    canViewProfileContentOf: jest.fn().mockResolvedValue(true),
  }
  const service = new PollsService(
    prisma as unknown as PrismaService,
    users as unknown as UserService,
    audit() as unknown as AuditService,
    queueMock() as unknown as QueueService,
  )
  // Представление результата — не предмет этих тестов.
  jest.spyOn(service, 'get').mockResolvedValue({} as never)
  return { service, prisma, tx, users }
}

describe('PollsService — голосование', () => {
  it('проверка «уже голосовал» и запись идут под локом в одной транзакции', async () => {
    const { service, tx } = setup(0)
    await service.vote(voter, 'p1', { optionIds: ['o1'] })
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.pollVote.createMany).toHaveBeenCalledWith({
      data: [{ pollId: 'p1', optionId: 'o1', userId: 'u1' }],
    })
  })

  it('повторный голос без allowRevote → CONFLICT, второй вариант не пишется', async () => {
    const { service, tx } = setup(1)
    const err = await service.vote(voter, 'p1', { optionIds: ['o2'] }).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(tx.pollVote.createMany).not.toHaveBeenCalled()
  })

  it('отменить голос после закрытия опроса нельзя', async () => {
    const { service, prisma, tx } = setup(1)
    prisma.poll.findUnique.mockResolvedValue({
      ...poll,
      allowRevote: true,
      closesAt: new Date(Date.now() - 1000),
    })
    const err = await service.cancelVote(voter, 'p1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(tx.pollVote.deleteMany).not.toHaveBeenCalled()
  })
})

// Закрытый профиль (profileVisibility) скрывает и опросы: раньше опрос с видимостью ALL
// отдавался по прямому запросу любому вошедшему — студенту другого вуза и работодателю.
describe('PollsService — видимость профиля автора (§14.7)', () => {
  function closedSetup() {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(poll.user) },
      poll: {
        findUnique: jest.fn().mockResolvedValue(poll),
        findMany: jest.fn().mockResolvedValue([poll]),
      },
      $transaction: jest.fn(),
    }
    const users = {
      canViewProfileContent: jest.fn().mockResolvedValue(false),
      canViewProfileContentOf: jest.fn().mockResolvedValue(false),
    }
    const service = new PollsService(
      prisma as unknown as PrismaService,
      users as unknown as UserService,
      audit() as unknown as AuditService,
      queueMock() as unknown as QueueService,
    )
    return { service, prisma, users }
  }

  it('опросы закрытого профиля списком не отдаются — до запроса опросов', async () => {
    const { service, prisma, users } = closedSetup()
    expect(await service.listByUser(voter, 'author')).toEqual([])
    expect(users.canViewProfileContentOf).toHaveBeenCalledWith(voter, poll.user)
    expect(prisma.poll.findMany).not.toHaveBeenCalled()
  })

  it('опрос закрытого профиля по id → NOT_FOUND', async () => {
    const { service, users } = closedSetup()
    const err = await service.get(voter, 'p1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(users.canViewProfileContentOf).toHaveBeenCalledWith(voter, poll.user)
  })

  it('голос в опросе закрытого профиля → NOT_FOUND, голос не пишется', async () => {
    const { service, prisma } = closedSetup()
    const err = await service.vote(voter, 'p1', { optionIds: ['o1'] }).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('комментарии к опросу закрытого профиля → NOT_FOUND', async () => {
    const { service } = closedSetup()
    const err = await service.listComments(voter, 'p1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})

// E-F08: чужой опрос и комментарий к нему снимает модератор — по правилам постов.
describe('PollsService — снятие модератором (E-F08)', () => {
  const mod = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
    sub: 'mod',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: null,
  })
  const author = (over: Record<string, unknown> = {}) => ({
    role: Role.STUDENT,
    universityId: 'uni-1',
    facultyId: 'f1',
    ...over,
  })

  function modSetup() {
    const prisma = {
      poll: { findUnique: jest.fn(), delete: jest.fn() },
      contentComment: { findUnique: jest.fn(), delete: jest.fn() },
    }
    const log = audit()
    const service = new PollsService(
      prisma as unknown as PrismaService,
      {} as UserService,
      log as unknown as AuditService,
      queueMock() as unknown as QueueService,
    )
    return { service, prisma, audit: log }
  }

  it('модератор вуза снимает опрос студента своего вуза — с записью в аудит', async () => {
    const { service, prisma, audit } = modSetup()
    prisma.poll.findUnique.mockResolvedValue({ userId: 'stud', user: author() })
    await service.remove(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-1' }), 'p1', ctx)
    expect(prisma.poll.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'poll_deleted', metadata: { authorId: 'stud' } }),
    )
  })

  it('автор удаляет свой опрос без записи в аудит', async () => {
    const { service, prisma, audit } = modSetup()
    prisma.poll.findUnique.mockResolvedValue({ userId: 'u1', user: author() })
    await service.remove(voter, 'p1', ctx)
    expect(prisma.poll.delete).toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('не-модератор чужой опрос не удалит → FORBIDDEN', async () => {
    const { service, prisma } = modSetup()
    prisma.poll.findUnique.mockResolvedValue({ userId: 'stud', user: author() })
    const err = await service
      .remove(mod(Role.TEACHER, { universityId: 'uni-1' }), 'p1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.poll.delete).not.toHaveBeenCalled()
  })

  it('модератор вуза: опрос автора другого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = modSetup()
    prisma.poll.findUnique.mockResolvedValue({
      userId: 'stud',
      user: author({ universityId: 'uni-2' }),
    })
    const err = await service
      .remove(mod(Role.UNIVERSITY_MODERATOR, { universityId: 'uni-1' }), 'p1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
    expect(prisma.poll.delete).not.toHaveBeenCalled()
  })

  it('модератор платформы не снимает опрос админа платформы (ранг)', async () => {
    const { service, prisma } = modSetup()
    prisma.poll.findUnique.mockResolvedValue({
      userId: 'root',
      user: author({ role: Role.PLATFORM_ADMIN, universityId: null }),
    })
    const err = await service.remove(mod(Role.PLATFORM_MODERATOR), 'p1', ctx).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('комментарий к опросу: декан снимает комментарий студента своего факультета', async () => {
    const { service, prisma, audit } = modSetup()
    prisma.contentComment.findUnique.mockResolvedValue({
      authorId: 'stud',
      pollId: 'p1',
      author: author(),
      poll: { userId: 'other', user: author({ facultyId: 'f2' }) },
    })
    await service.deleteComment(
      mod(Role.DEAN, { universityId: 'uni-1', facultyId: 'f1' }),
      'p1',
      'c1',
      ctx,
    )
    expect(prisma.contentComment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'content_comment_deleted',
        metadata: { pollId: 'p1', authorId: 'stud' },
      }),
    )
  })

  it('комментарий к опросу: посторонний не удалит → FORBIDDEN', async () => {
    const { service, prisma } = modSetup()
    prisma.contentComment.findUnique.mockResolvedValue({
      authorId: 'stud',
      pollId: 'p1',
      author: author(),
      poll: { userId: 'other', user: author() },
    })
    const err = await service.deleteComment(voter, 'p1', 'c1', ctx).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.contentComment.delete).not.toHaveBeenCalled()
  })
})

// Строки шаблона $executeRaw`...` — по ним видно, какой лок взят: разделяемый или исключительный.
function lockCalls(executeRaw: jest.Mock): { shared: boolean; key: unknown }[] {
  return executeRaw.mock.calls.map(([strings, key]: [TemplateStringsArray, unknown]) => ({
    shared: strings.join('?').includes('pg_advisory_xact_lock_shared'),
    key,
  }))
}

// E-F17: правка и голос под одним локом опроса; отмена голоса — с теми же проверками.
describe('PollsService — правка против голоса (E-F17)', () => {
  it('голос берёт разделяемый лок опроса, затем лок голосующего', async () => {
    const { service, tx } = setup(0)
    await service.vote(voter, 'p1', { optionIds: ['o1'] })
    expect(lockCalls(tx.$executeRaw)).toEqual([
      { shared: true, key: 'poll:p1' },
      { shared: false, key: 'poll-vote:p1:u1' },
    ])
  })

  it('варианты сверяются с перечитанными под локом: заменённые правкой → BAD_REQUEST', async () => {
    const { service, tx } = setup(0)
    tx.poll.findUnique.mockResolvedValue({ ...poll, options: [{ id: 'new-1' }, { id: 'new-2' }] })
    const err = await service.vote(voter, 'p1', { optionIds: ['o1'] }).catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(tx.pollVote.createMany).not.toHaveBeenCalled()
  })

  it('опрос сняли в черновик, пока голос ждал лока → NOT_FOUND', async () => {
    const { service, tx } = setup(0)
    tx.poll.findUnique.mockResolvedValue({ ...poll, status: 'DRAFT' })
    const err = await service.vote(voter, 'p1', { optionIds: ['o1'] }).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(tx.pollVote.createMany).not.toHaveBeenCalled()
  })

  it('правка: исключительный лок и подсчёт голосов внутри транзакции', async () => {
    const { service, prisma, tx } = setup(0)
    prisma.poll.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' })
    const dto = {
      question: 'Q',
      options: ['a', 'b'],
      multiple: false,
      anonymous: true,
      allowRevote: false,
      resultsVisibility: 'AFTER_VOTE' as const,
      visibility: 'ALL' as const,
      status: 'PUBLISHED' as const,
    }
    await service.update(voter, 'p1', dto)
    expect(lockCalls(tx.$executeRaw)).toEqual([{ shared: false, key: 'poll:p1' }])
    expect(tx.pollVote.count).toHaveBeenCalledWith({ where: { pollId: 'p1' } })
    expect(tx.pollOption.deleteMany).toHaveBeenCalledWith({ where: { pollId: 'p1' } })
    expect(tx.poll.update).toHaveBeenCalled()
  })

  it('правка: голос успел записаться до лока → CONFLICT, варианты не удаляются', async () => {
    const { service, prisma, tx } = setup(1)
    prisma.poll.findUnique.mockResolvedValue({ id: 'p1', userId: 'u1' })
    const err = await service
      .update(voter, 'p1', {
        question: 'Q',
        options: ['a', 'b'],
        multiple: false,
        anonymous: true,
        allowRevote: false,
        resultsVisibility: 'AFTER_VOTE',
        visibility: 'ALL',
        status: 'PUBLISHED',
      })
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(tx.pollOption.deleteMany).not.toHaveBeenCalled()
    expect(tx.poll.update).not.toHaveBeenCalled()
  })

  it('отмена голоса — под разделяемым локом опроса', async () => {
    const { service, prisma, tx } = setup(1)
    prisma.poll.findUnique.mockResolvedValue({ ...poll, allowRevote: true })
    await service.cancelVote(voter, 'p1')
    expect(lockCalls(tx.$executeRaw)).toEqual([{ shared: true, key: 'poll:p1' }])
    expect(tx.pollVote.deleteMany).toHaveBeenCalledWith({ where: { pollId: 'p1', userId: 'u1' } })
  })

  it('отмена голоса в невидимом опросе → NOT_FOUND', async () => {
    const { service, prisma, users, tx } = setup(1)
    // Опрос «для группы», а смотрящий не из группы автора.
    prisma.poll.findUnique.mockResolvedValueOnce({
      ...poll,
      allowRevote: true,
      visibility: 'GROUP',
      user: { ...poll.user, groupId: 'g-1' },
    })
    expect((await service.cancelVote(voter, 'p1').catch((e) => e)).code).toBe('NOT_FOUND')
    // Закрытый профиль автора.
    prisma.poll.findUnique.mockResolvedValueOnce({ ...poll, allowRevote: true })
    users.canViewProfileContentOf.mockResolvedValueOnce(false)
    expect((await service.cancelVote(voter, 'p1').catch((e) => e)).code).toBe('NOT_FOUND')
    expect(tx.pollVote.deleteMany).not.toHaveBeenCalled()
  })

  it('отмена голоса в черновике (даже своём) → NOT_FOUND', async () => {
    const { service, prisma, tx } = setup(1)
    prisma.poll.findUnique.mockResolvedValue({
      ...poll,
      userId: 'u1',
      allowRevote: true,
      status: 'DRAFT',
    })
    expect((await service.cancelVote(voter, 'p1').catch((e) => e)).code).toBe('NOT_FOUND')
    expect(tx.pollVote.deleteMany).not.toHaveBeenCalled()
  })
})

describe('PollsService — список опросов автора (E-F17)', () => {
  function listSetup(rows: unknown[] = []) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ ...poll.user, facultyId: 'f-1' }) },
      poll: {
        findMany: jest.fn().mockResolvedValue(rows),
        findUnique: jest.fn().mockResolvedValue({ createdAt: new Date(2000), id: 'b' }),
        count: jest.fn().mockResolvedValue(0),
      },
    }
    const users = { canViewProfileContentOf: jest.fn().mockResolvedValue(true) }
    const service = new PollsService(
      prisma as unknown as PrismaService,
      users as unknown as UserService,
      audit() as unknown as AuditService,
      queueMock() as unknown as QueueService,
    )
    // Результаты голосования — не предмет этих тестов.
    jest
      .spyOn(
        service as unknown as { withResults: (p: unknown[]) => Promise<unknown[]> },
        'withResults',
      )
      .mockImplementation(async (p) => p)
    return { service, prisma, users }
  }

  it('автор видит всё своё, без запроса за профилем', async () => {
    const { service, prisma } = listSetup()
    await service.listByUser({ ...voter, sub: 'author' }, 'author')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.poll.findMany.mock.calls[0][0].where).toEqual({ userId: 'author' })
  })

  it('чужой: опубликованные и видимые ему — условием в запросе, до take', async () => {
    const { service, prisma } = listSetup()
    await service.listByUser(voter, 'author')
    const args = prisma.poll.findMany.mock.calls[0][0]
    // Свой вуз — ALL и UNIVERSITY; факультет и группа автора смотрящему чужие.
    expect(args.where).toEqual({
      userId: 'author',
      status: 'PUBLISHED',
      visibility: { in: ['ALL', 'UNIVERSITY'] },
    })
    expect(args.take).toBe(100)
  })

  it('платформенная роль видит любую visibility, но не черновики', async () => {
    const { service, prisma } = listSetup()
    await service.listByUser(
      { ...voter, role: Role.PLATFORM_MODERATOR, universityId: null },
      'author',
    )
    expect(prisma.poll.findMany.mock.calls[0][0].where).toEqual({
      userId: 'author',
      status: 'PUBLISHED',
    })
  })

  it('без limit/cursor — прежний массив', async () => {
    const { service } = listSetup([{ id: 'a' }, { id: 'b' }])
    const res = await service.listByUser(voter, 'author')
    expect(Array.isArray(res)).toBe(true)
  })

  it('с limit — страница: take limit+1, cursor — позиция последнего на странице', async () => {
    const { service, prisma } = listSetup([
      { id: 'a', createdAt: new Date(3000) },
      { id: 'b', createdAt: new Date(2000) },
      { id: 'c', createdAt: new Date(1000) },
    ])
    const res = await service.listByUser(voter, 'author', { limit: 2 })
    expect(res).toBeInstanceOf(Paginated)
    const page = res as Paginated<{ id: string }>
    expect(page.items.map((p) => p.id)).toEqual(['a', 'b'])
    expect(page.meta).toEqual({ cursor: '2000.b', hasNext: true })
    expect(prisma.poll.findMany.mock.calls[0][0]).toMatchObject({
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  })

  it('с cursor — строго раньше позиции курсора (голый id ищется по опросу)', async () => {
    const { service, prisma } = listSetup([{ id: 'c', createdAt: new Date(1000) }])
    const res = (await service.listByUser(voter, 'author', { cursor: 'b' })) as Paginated<unknown>
    const args = prisma.poll.findMany.mock.calls[0][0]
    expect(args.take).toBe(21)
    expect(args.cursor).toBeUndefined()
    expect(JSON.stringify(args.where)).toContain('"id":{"lt":"b"}')
    expect(res.meta).toEqual({ cursor: undefined, hasNext: false })
  })

  it('закрытый профиль в режиме страницы — пустая страница', async () => {
    const { service, prisma, users } = listSetup()
    users.canViewProfileContentOf.mockResolvedValue(false)
    const res = await service.listByUser(voter, 'author', { limit: 10 })
    expect(res).toEqual(new Paginated([], { hasNext: false }))
    expect(prisma.poll.findMany).not.toHaveBeenCalled()
  })

  // Автор целиком, как его выбирает вызывающий (PROFILE_CONTENT_OWNER_SELECT).
  const countAuthor = {
    ...poll.user,
    facultyId: 'f-1',
    role: Role.STUDENT,
    profileVisibility: 'PUBLIC',
  }

  it('итог для бейджа — тем же условием, что и список, без потолка (E-F25)', async () => {
    const { service, prisma } = listSetup()
    prisma.poll.count.mockResolvedValue(140)
    await expect(service.countVisibleByUser(voter, countAuthor)).resolves.toBe(140)
    expect(prisma.poll.count).toHaveBeenCalledWith({
      where: { userId: 'author', status: 'PUBLISHED', visibility: { in: ['ALL', 'UNIVERSITY'] } },
    })
  })

  it('автору итог — все его опросы, включая черновики', async () => {
    const { service, prisma } = listSetup()
    await service.countVisibleByUser({ ...voter, sub: 'author' }, countAuthor)
    expect(prisma.poll.count).toHaveBeenCalledWith({ where: { userId: 'author' } })
  })
})

describe('PollsService — комментарии (E-F12, E-F17)', () => {
  const comment = (id: string) => ({
    id,
    content: 'text',
    createdAt: new Date(),
    authorId: 'u1',
    author: { id: 'u1', firstName: 'Айгерим', lastName: 'Сапарова', avatarUrl: null },
  })

  function commentsSetup() {
    const prisma = {
      poll: { findUnique: jest.fn().mockResolvedValue(poll) },
      contentComment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(comment('c1')),
      },
      userBlock: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    const users = { canViewProfileContentOf: jest.fn().mockResolvedValue(true) }
    const queue = queueMock()
    const service = new PollsService(
      prisma as unknown as PrismaService,
      users as unknown as UserService,
      audit() as unknown as AuditService,
      queue as unknown as QueueService,
    )
    return { service, prisma, queue }
  }

  it('видимость проверяется лёгкой выборкой — без вариантов и счётчиков', async () => {
    const { service, prisma } = commentsSetup()
    await service.listComments(voter, 'p1')
    const { select } = prisma.poll.findUnique.mock.calls[0][0]
    expect(select).not.toHaveProperty('options')
    expect(select).not.toHaveProperty('_count')
  })

  it('без параметров — последние 200 по порядку написания', async () => {
    const { service, prisma } = commentsSetup()
    // БД отдаёт свежие сверху — наружу уходят в хронологическом порядке.
    prisma.contentComment.findMany.mockResolvedValue([comment('c3'), comment('c2'), comment('c1')])
    const res = (await service.listComments(voter, 'p1')) as { id: string }[]
    expect(res.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(prisma.contentComment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pollId: 'p1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    )
    expect(prisma.contentComment.count).not.toHaveBeenCalled()
  })

  it('с limit — страница свежих сверху, cursor — самый старый, total — всего', async () => {
    const { service, prisma } = commentsSetup()
    prisma.contentComment.findMany.mockResolvedValue([
      { ...comment('c5'), createdAt: new Date(5000) },
      { ...comment('c4'), createdAt: new Date(4000) },
      { ...comment('c3'), createdAt: new Date(3000) },
    ])
    prisma.contentComment.count.mockResolvedValue(5)
    const res = await service.listComments(voter, 'p1', { limit: 2, cursor: '6000.c6' })
    expect(res).toBeInstanceOf(Paginated)
    const page = res as Paginated<{ id: string }>
    expect(page.items.map((c) => c.id)).toEqual(['c5', 'c4'])
    expect(page.meta).toEqual({ cursor: '4000.c4', hasNext: true, total: 5 })
    const args = prisma.contentComment.findMany.mock.calls[0][0]
    expect(args.take).toBe(3)
    expect(args.cursor).toBeUndefined()
    // Позиция — из самого курсора: стёртый навсегда комментарий c6 листание не обрывает.
    expect(args.where).toEqual({
      AND: [
        { pollId: 'p1' },
        {
          OR: [
            { createdAt: { lt: new Date(6000) } },
            { createdAt: new Date(6000), id: { lt: 'c6' } },
          ],
        },
      ],
    })
    expect(prisma.contentComment.count).toHaveBeenCalledWith({ where: { pollId: 'p1' } })
  })

  it('новый комментарий → уведомление автору опроса, одна строка на опрос', async () => {
    const { service, queue } = commentsSetup()
    await service.addComment(voter, 'p1', { content: 'text' })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      'comment-added',
      {
        recipientIds: ['author'],
        type: 'POST',
        titleKey: 'comments.new.title',
        bodyKey: 'comments.poll.body',
        params: { name: 'Айгерим Сапарова' },
        data: { pollId: 'p1', commentId: 'c1', url: '/profile/author' },
        dedupeKey: 'poll-comment:c1',
        collapseKey: 'poll-comments:p1',
      },
      { jobId: 'poll-comment:c1' },
    )
  })

  it('свой комментарий к своему опросу — без уведомления', async () => {
    const { service, queue } = commentsSetup()
    await service.addComment({ ...voter, sub: 'author' }, 'p1', { content: 'text' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('личная блокировка между автором и комментатором — без уведомления', async () => {
    const { service, prisma, queue } = commentsSetup()
    prisma.userBlock.findFirst.mockResolvedValue({ id: 'b1' })
    await service.addComment(voter, 'p1', { content: 'text' })
    expect(prisma.userBlock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockerId: 'author', blockedId: 'u1' },
            { blockerId: 'u1', blockedId: 'author' },
          ],
        },
      }),
    )
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('сбой очереди не роняет добавление комментария', async () => {
    const { service, queue } = commentsSetup()
    queue.enqueue.mockRejectedValue(new Error('redis down'))
    await expect(service.addComment(voter, 'p1', { content: 'text' })).resolves.toMatchObject({
      id: 'c1',
    })
  })
})
