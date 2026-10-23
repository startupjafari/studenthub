import { Role } from '@studenthub/shared-types'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { SecurityVisitorsService } from './security-visitors.service'

const actor = (role: Role, universityId: string | null = 'uni-A'): JwtPayload => ({
  sub: 'u-1',
  role,
  universityId,
  facultyId: null,
  groupId: null,
})

const row = {
  id: 'v-1',
  fullName: 'Иванов Иван',
  purpose: 'В деканат ФИТ',
  documentType: 'ID_CARD',
  documentLast4: '1234',
  phone: null,
  enteredAt: new Date('2026-10-23T05:00:00.000Z'),
  exitedAt: null,
  createdByName: 'Тестов Ерлан',
}

function setup() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ firstName: 'Ерлан', lastName: 'Тестов' }) },
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    securityVisitor: {
      create: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const service = new SecurityVisitorsService(prisma as unknown as PrismaService)
  return { service, prisma }
}

describe('SecurityVisitorsService', () => {
  it('охрана записывает посетителя своего вуза со снимком своего имени', async () => {
    const { service, prisma } = setup()
    const item = await service.create(actor(Role.SECURITY_GUARD), {
      fullName: 'Иванов Иван',
      purpose: 'В деканат ФИТ',
      documentType: 'ID_CARD',
      documentLast4: '1234',
    })
    expect(prisma.securityVisitor.create.mock.calls[0][0].data).toMatchObject({
      universityId: 'uni-A',
      createdById: 'u-1',
      createdByName: 'Тестов Ерлан',
      phone: null,
    })
    expect(item.enteredAt).toBe('2026-10-23T05:00:00.000Z')
  })

  it('админ вуза журнал читает, но не ведёт', async () => {
    const { service } = setup()
    await expect(
      service.create(actor(Role.UNIVERSITY_ADMIN), { fullName: 'Иванов', purpose: 'Курьер' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.list(actor(Role.UNIVERSITY_ADMIN), { page: 1, limit: 20, status: 'all' }),
    ).resolves.toMatchObject({ meta: { total: 1 } })
  })

  it('другие роли журнал не видят', async () => {
    const { service } = setup()
    await expect(
      service.list(actor(Role.DEAN), { page: 1, limit: 20, status: 'all' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('выход — только в своём вузе: чужая запись неотличима от несуществующей', async () => {
    const { service, prisma } = setup()
    prisma.securityVisitor.updateMany.mockResolvedValue({ count: 0 })
    prisma.securityVisitor.findFirst.mockResolvedValue(null)
    await expect(service.exit(actor(Role.SECURITY_GUARD), 'v-other')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.securityVisitor.updateMany.mock.calls[0][0].where).toEqual({
      id: 'v-other',
      universityId: 'uni-A',
      exitedAt: null,
    })
  })

  it('выход дважды — 409 exited', async () => {
    const { service, prisma } = setup()
    prisma.securityVisitor.updateMany.mockResolvedValue({ count: 0 })
    prisma.securityVisitor.findFirst.mockResolvedValue({ ...row, exitedAt: new Date() })
    await expect(service.exit(actor(Role.SECURITY_GUARD), 'v-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'exited' }],
    })
  })

  it('«в здании» — без отметки выхода, день — по часам вуза', async () => {
    const { service, prisma } = setup()
    await service.list(actor(Role.SECURITY_GUARD), {
      page: 1,
      limit: 20,
      status: 'inside',
      date: '2026-10-23',
    })
    const where = prisma.securityVisitor.findMany.mock.calls[0][0].where
    expect(where.exitedAt).toBeNull()
    // Полночь в Алматы (UTC+5) — 19:00 UTC накануне.
    expect(where.enteredAt.gte.toISOString()).toBe('2026-10-22T19:00:00.000Z')
    expect(where.enteredAt.lt.toISOString()).toBe('2026-10-23T19:00:00.000Z')
  })
})
