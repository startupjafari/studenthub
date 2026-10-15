import { Role } from '@studenthub/shared-types'
import { PollsService } from './polls.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
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
  const service = new PollsService(prisma as unknown as PrismaService)
  // Представление результата — не предмет этих тестов.
  jest.spyOn(service, 'get').mockResolvedValue({} as never)
  return { service, prisma, tx }
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
