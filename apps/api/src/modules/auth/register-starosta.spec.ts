import { AuthService } from './auth.service'

// A-F21: староста, пришедший по инвайту, не становился старостой группы — в группе со
// старостой их оказывалось два, а `Group.starostaId` указывал на прежнего.
function setup(role: 'STAROSTA' | 'STUDENT', groupId: string | null = 'grp-1') {
  const tx = { marker: 'tx' }
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    refreshToken: { create: jest.fn().mockResolvedValue({ id: 'rt-1' }) },
  }
  const users = {
    findEmailOwnerId: jest.fn().mockResolvedValue(null),
    createInvitedUser: jest.fn().mockResolvedValue({
      sub: 'u-new',
      role,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId,
    }),
    assignInvitedStarosta: jest.fn().mockResolvedValue(['u-old']),
    afterStarostaChange: jest.fn().mockResolvedValue(undefined),
  }
  const invites = {
    claimInvite: jest.fn().mockResolvedValue({
      id: 'inv-1',
      role,
      email: 'new@uni.kz',
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId,
      createdById: 'dean-1',
    }),
    markUsed: jest.fn(),
  }
  const service = new AuthService(
    prisma as never,
    { sign: jest.fn(() => 'access') } as never,
    { get: jest.fn((k: string) => (k === 'JWT_REFRESH_EXPIRES_IN' ? '30d' : 0)) } as never,
    { record: jest.fn() } as never,
    { hash: jest.fn().mockResolvedValue('hash') } as never,
    users as never,
    invites as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { assertAllowed: jest.fn() } as never,
    {} as never,
    {} as never,
    { removeAllForUser: jest.fn() } as never,
  )
  return { service, users, tx }
}

const registration = {
  token: 'invite-token',
  username: 'starosta',
  firstName: 'Айгерим',
  lastName: 'Серикова',
  password: 'Secret123!',
  birthDate: '2000-01-01',
  consent: true as const,
}

describe('AuthService.registerByInvite — инвайт старосты', () => {
  it('новый староста становится старостой группы в той же транзакции', async () => {
    const { service, users, tx } = setup('STAROSTA')

    await service.registerByInvite(registration, {})

    expect(users.assignInvitedStarosta).toHaveBeenCalledWith(tx, 'grp-1', 'u-new')
  })

  it('прежнему старосте после коммита гасятся сессии — от имени выдавшего инвайт', async () => {
    const { service, users } = setup('STAROSTA')

    await service.registerByInvite(registration, {})

    expect(users.afterStarostaChange).toHaveBeenCalledWith('dean-1', 'grp-1', null, ['u-old'])
  })

  it('инвайт студента группу не трогает', async () => {
    const { service, users } = setup('STUDENT')

    await service.registerByInvite(registration, {})

    expect(users.assignInvitedStarosta).not.toHaveBeenCalled()
    expect(users.afterStarostaChange).not.toHaveBeenCalled()
  })
})
