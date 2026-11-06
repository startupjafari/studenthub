import { Role } from '@studenthub/shared-types'
import { LibraryDebtsService } from './library-debts.service'
import { UNSETTLED_DEBT_WHERE } from './library-loans.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Долги при выпуске и отчислении, справка студенту (Фаза 20.11).

const reader: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

const dean: JwtPayload = {
  sub: 'dean-1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

function setup(reader: Record<string, unknown> | null, openLoans: unknown[] = []) {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(reader) },
    loan: { findMany: jest.fn().mockResolvedValue(openLoans) },
    reservation: { count: jest.fn().mockResolvedValue(1) },
  }
  const settings = { get: jest.fn().mockResolvedValue({ enabled: true }) }
  const loans = {
    toItems: jest.fn().mockImplementation((rows: unknown[]) => Promise.resolve(rows)),
    timezoneOf: jest.fn().mockResolvedValue('Asia/Almaty'),
  }
  return {
    service: new LibraryDebtsService(prisma as never, settings as never, loans as never),
    prisma,
  }
}

const student = {
  id: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  firstName: 'Нурлан',
  lastName: 'Оспанов',
}

describe('Долги библиотеки', () => {
  it('декан своего факультета видит книги на руках', async () => {
    const { service } = setup(student, [{ id: 'loan-1' }])
    const debts = await service.debts(dean, 'stu-1')
    expect(debts).toMatchObject({ clear: false, activeReservations: 1, enabled: true })
    expect(debts.loans).toHaveLength(1)
  })

  it('без книг — clear', async () => {
    const { service } = setup(student)
    await expect(service.debts(dean, 'stu-1')).resolves.toMatchObject({ clear: true })
  })

  it('долги декану — открытые и утерянные без погашения', async () => {
    const { service, prisma } = setup(student, [{ id: 'loan-lost', status: 'LOST' }])
    const debts = await service.debts(dean, 'stu-1')
    expect(debts.clear).toBe(false)
    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { readerId: 'stu-1', universityId: 'uni-1', ...UNSETTLED_DEBT_WHERE },
      }),
    )
  })

  it('студент чужого факультета — WRONG_SCOPE', async () => {
    const { service } = setup({ ...student, facultyId: 'fac-2' })
    await expect(service.debts(dean, 'stu-1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('не студент — 404', async () => {
    const { service } = setup({ ...student, role: Role.TEACHER })
    await expect(service.debts(dean, 'stu-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Справка «задолженностей нет»', () => {
  const profile = {
    firstName: 'Нурлан',
    lastName: 'Оспанов',
    middleName: null,
    studentCardNumber: '42',
    group: { name: 'ИТ-23-1' },
    faculty: { name: 'ФИТ' },
    university: { name: 'КазНУ' },
  }

  it('утерянная книга без погашения — справка не чистая', async () => {
    const { service, prisma } = setup(profile, [{ id: 'loan-lost', status: 'LOST' }])
    const clearance = await service.clearance(reader)
    expect(clearance.clear).toBe(false)
    expect(clearance.loans).toHaveLength(1)
    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { readerId: 'stu-1', universityId: 'uni-1', ...UNSETTLED_DEBT_WHERE },
      }),
    )
  })

  it('долг считается по открытым и утерянным без отметки погашения', () => {
    expect(UNSETTLED_DEBT_WHERE).toEqual({
      OR: [{ status: 'OPEN' }, { status: 'LOST', lostSettledAt: null }],
    })
  })

  it('долгов нет — справка чистая', async () => {
    const { service } = setup(profile)
    await expect(service.clearance(reader)).resolves.toMatchObject({ clear: true, loans: [] })
  })
})
