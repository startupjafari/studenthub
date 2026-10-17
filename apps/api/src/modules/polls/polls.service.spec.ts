import { Role } from '@studenthub/shared-types'
import { PollsService } from './polls.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { UserService } from '../users/users.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) })

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
  user: { universityId: 'uni-1', facultyId: null, groupId: null },
}

function setup(existingVotes: number) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
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
    const { service, prisma } = setup(1)
    prisma.poll.findUnique.mockResolvedValue({
      id: 'p1',
      allowRevote: true,
      closesAt: new Date(Date.now() - 1000),
    })
    const err = await service.cancelVote(voter, 'p1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.pollVote.deleteMany).not.toHaveBeenCalled()
  })
})

// Закрытый профиль (profileVisibility) скрывает и опросы: раньше опрос с видимостью ALL
// отдавался по прямому запросу любому вошедшему — студенту другого вуза и работодателю.
describe('PollsService — видимость профиля автора (§14.7)', () => {
  function closedSetup() {
    const prisma = {
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
    )
    return { service, prisma, users }
  }

  it('опросы закрытого профиля списком не отдаются — до запроса в БД', async () => {
    const { service, prisma, users } = closedSetup()
    expect(await service.listByUser(voter, 'author')).toEqual([])
    expect(users.canViewProfileContent).toHaveBeenCalledWith(voter, 'author')
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
