import { Role } from '@studenthub/shared-types'
import { LibraryDebtsService } from './library-debts.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Долги при выпуске и отчислении, справка студенту (Фаза 20.11).

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

  it('студент чужого факультета — WRONG_SCOPE', async () => {
    const { service } = setup({ ...student, facultyId: 'fac-2' })
    await expect(service.debts(dean, 'stu-1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('не студент — 404', async () => {
    const { service } = setup({ ...student, role: Role.TEACHER })
    await expect(service.debts(dean, 'stu-1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
