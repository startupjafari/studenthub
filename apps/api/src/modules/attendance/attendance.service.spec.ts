import { Role } from '@studenthub/shared-types'
import type { ConfigService } from '@nestjs/config'
import { AttendanceService } from './attendance.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AppException } from '../../common/exceptions/app.exception'

const MAIN = 'teacher-main'
const SUB = 'teacher-sub'
const DATE = '2026-09-15'

function setup() {
  const prisma = {
    pair: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pair-1',
        groupId: 'grp-1',
        teacherId: MAIN,
        subject: 'Матанализ',
        group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
      }),
    },
    scheduleChange: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    attendance: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockResolvedValue([[], []]),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const config = { get: jest.fn().mockReturnValue('secret') }
  const service = new AttendanceService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma }
}

function teacher(sub: string): JwtPayload {
  return { sub, role: Role.TEACHER, universityId: 'uni-1', facultyId: null, groupId: null }
}

// ── C-F12: журнал занятия при замене ведёт заменяющий ──────────────────────
describe('AttendanceService — право вести журнал при замене (C-F12)', () => {
  it('без замены основной преподаватель ведёт журнал своей пары', async () => {
    const { service } = setup()
    const res = await service.roster(teacher(MAIN), { pairId: 'pair-1', date: DATE })
    expect(res.pairId).toBe('pair-1')
  })

  it('заменяющий на дату замены открывает ростер и получает QR', async () => {
    const { service, prisma } = setup()
    prisma.scheduleChange.findFirst.mockResolvedValue({ newTeacherId: SUB })
    await expect(
      service.roster(teacher(SUB), { pairId: 'pair-1', date: DATE }),
    ).resolves.toMatchObject({ pairId: 'pair-1' })
    await expect(
      service.createQrToken(teacher(SUB), { pairId: 'pair-1', date: DATE }),
    ).resolves.toMatchObject({ date: DATE })
    // Ищем последнюю замену именно этой пары на эту дату.
    expect(prisma.scheduleChange.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pairId: 'pair-1', date: new Date(DATE), type: 'SUBSTITUTED' },
        orderBy: { createdAt: 'desc' },
      }),
    )
  })

  it('основной преподаватель на дату замены журнал не ведёт → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.scheduleChange.findFirst.mockResolvedValue({ newTeacherId: SUB })
    const err = await service
      .mark(teacher(MAIN), { pairId: 'pair-1', date: DATE, entries: [] }, {})
      .catch((e) => e)
    expect(err).toBeInstanceOf(AppException)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('заменяющий без замены на эту дату → FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service.roster(teacher(SUB), { pairId: 'pair-1', date: DATE }).catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('аккаунт заменяющего удалён (newTeacherId = null) → занятие снова за основным', async () => {
    const { service, prisma } = setup()
    prisma.scheduleChange.findFirst.mockResolvedValue({ newTeacherId: null })
    await expect(
      service.roster(teacher(MAIN), { pairId: 'pair-1', date: DATE }),
    ).resolves.toMatchObject({ pairId: 'pair-1' })
  })

  it('декан факультета замену не проверяет', async () => {
    const { service, prisma } = setup()
    const dean: JwtPayload = {
      sub: 'dean-1',
      role: Role.DEAN,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: null,
    }
    await service.roster(dean, { pairId: 'pair-1', date: DATE })
    expect(prisma.scheduleChange.findFirst).not.toHaveBeenCalled()
  })
})
