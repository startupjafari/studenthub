import { Role } from '@studenthub/shared-types'
import { PollsService } from './polls.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { UserService } from '../users/users.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

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
