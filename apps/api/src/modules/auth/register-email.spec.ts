import { AuthService } from './auth.service'

// A-F01: адрес при регистрации — в нижнем регистре, а занятость проверяется без учёта
// регистра. Уникальный индекс email различает регистр и учётку «Ivanov@Uni.kz», заведённую
// до нормализации, от «ivanov@uni.kz» не защищал.
function setup(owner: string | null) {
  const tx = {}
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    refreshToken: { create: jest.fn().mockResolvedValue({ id: 'rt-1' }) },
  }
  const users = {
    findEmailOwnerId: jest.fn().mockResolvedValue(owner),
    createInvitedUser: jest.fn().mockResolvedValue({
      sub: 'u-new',
      role: 'STUDENT',
      universityId: 'uni-1',
      facultyId: null,
      groupId: 'grp-1',
    }),
  }
  const invites = {
    claimInvite: jest.fn().mockResolvedValue({
      id: 'inv-1',
      role: 'STUDENT',
      // Инвайт выдан до нормализации — адрес как пришёл из таблицы деканата.
      email: 'Ivanov@Uni.KZ',
      universityId: 'uni-1',
      facultyId: null,
      groupId: 'grp-1',
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
  )
  return { service, users, invites }
}

const registration = {
  token: 'invite-token',
  username: 'ivanov',
  firstName: 'Иван',
  lastName: 'Иванов',
  password: 'Secret123!',
  birthDate: '2000-01-01',
  consent: true as const,
}

describe('AuthService.registerByInvite — email без учёта регистра', () => {
  it('адрес из инвайта сохраняется в нижнем регистре', async () => {
    const { service, users } = setup(null)
    await service.registerByInvite(registration, {})
    expect(users.findEmailOwnerId).toHaveBeenCalledWith('ivanov@uni.kz')
    expect(users.createInvitedUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'ivanov@uni.kz' }),
    )
  })

  it('адрес занят учёткой в другом регистре → CONFLICT, вторая учётка не заводится', async () => {
    const { service, users, invites } = setup('u-legacy')
    await expect(service.registerByInvite(registration, {})).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(users.createInvitedUser).not.toHaveBeenCalled()
    expect(invites.markUsed).not.toHaveBeenCalled()
  })
})
