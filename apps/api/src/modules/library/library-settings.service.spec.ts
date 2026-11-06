import { Role } from '@studenthub/shared-types'
import { LibrarySettingsService } from './library-settings.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function actor(role: Role, universityId: string | null = 'uni-1'): JwtPayload {
  return { sub: 'u-1', role, universityId, facultyId: null, groupId: null }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    defaultLoanDays: 14,
    maxLoanDays: 120,
    maxActiveLoans: 5,
    maxActiveReservations: 3,
    reservationHoldDays: 3,
    maxRenewals: 1,
    updatedAt: new Date('2026-10-22T10:00:00Z'),
    ...overrides,
  }
}

function setup(existing: ReturnType<typeof row> | null = null) {
  const prisma = {
    librarySettings: {
      findUnique: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(row(create))),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new LibrarySettingsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma, audit }
}

describe('LibrarySettingsService', () => {
  it('нет записи — модуль выключен, правила по умолчанию', async () => {
    const { service } = setup(null)
    const settings = await service.forActor(actor(Role.STUDENT))
    expect(settings).toMatchObject({ enabled: false, defaultLoanDays: 14, maxActiveLoans: 5 })
  })

  it('настройки видят читатели и фонд, но не преподаватель и не охрана', async () => {
    const { service } = setup(row())
    for (const role of [Role.STUDENT, Role.STAROSTA, Role.LIBRARIAN, Role.UNIVERSITY_ADMIN]) {
      await expect(service.forActor(actor(role))).resolves.toMatchObject({ enabled: true })
    }
    for (const role of [Role.TEACHER, Role.SECURITY_GUARD, Role.PLATFORM_ADMIN]) {
      await expect(service.forActor(actor(role))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    }
  })

  it('выключенный модуль — 409 с полем module', async () => {
    const { service } = setup(row({ enabled: false }))
    await expect(service.requireEnabled('uni-1')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [expect.objectContaining({ field: 'module' })],
    })
  })

  it('меняет правила только админ вуза своего вуза', async () => {
    const { service, prisma } = setup(row())
    await expect(
      service.update(actor(Role.LIBRARIAN), { maxActiveLoans: 3 }, ctx),
    ).rejects.toBeInstanceOf(AppException)
    await service.update(actor(Role.UNIVERSITY_ADMIN), { maxActiveLoans: 3 }, ctx)
    expect(prisma.librarySettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: 'uni-1' } }),
    )
  })

  it('срок по умолчанию не больше максимального — с учётом прежних значений', async () => {
    const { service } = setup(row({ maxLoanDays: 30 }))
    await expect(
      service.update(actor(Role.UNIVERSITY_ADMIN), { defaultLoanDays: 45 }, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'defaultLoanDays' })],
    })
  })

  it('включение и выключение пишутся в аудит отдельными действиями', async () => {
    const { service, audit } = setup(row({ enabled: false }))
    await service.update(actor(Role.UNIVERSITY_ADMIN), { enabled: true }, ctx)
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'library_enabled', entityId: 'uni-1' }),
    )
    await service.update(actor(Role.UNIVERSITY_ADMIN), { maxRenewals: 2 }, ctx)
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'library_settings_updated' }),
    )
  })
})
