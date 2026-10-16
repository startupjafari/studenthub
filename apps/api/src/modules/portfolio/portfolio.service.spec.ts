import { Role } from '@studenthub/shared-types'
import { PortfolioService, portfolioVisibilityWhere } from './portfolio.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function viewer(over: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'stu-2',
    role: Role.STUDENT,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
    ...over,
  }
}

function setup(owner: { universityId: string | null } | null = { universityId: 'uni-1' }) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(owner) },
    portfolioItem: { findMany: jest.fn().mockResolvedValue([]) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new PortfolioService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

/** Видимости, с которыми ушёл запрос записей. */
function requestedVisibilities(prisma: ReturnType<typeof setup>['prisma']): unknown {
  const args = prisma.portfolioItem.findMany.mock.calls[0]?.[0] as {
    where: { visibility?: { in: string[] } }
  }
  return args.where.visibility?.in
}

describe('portfolioVisibilityWhere — правило видимости записей', () => {
  it('владелец видит всё, включая PRIVATE', () => {
    expect(portfolioVisibilityWhere('owner')).toEqual({})
  })

  it('свой вуз — PUBLIC и UNIVERSITY', () => {
    expect(portfolioVisibilityWhere('university')).toEqual({
      visibility: { in: ['PUBLIC', 'UNIVERSITY'] },
    })
  })

  it('внешний зритель (аноним, работодатель) — только PUBLIC', () => {
    expect(portfolioVisibilityWhere('external')).toEqual({ visibility: { in: ['PUBLIC'] } })
  })
})

describe('PortfolioService — чужое портфолио', () => {
  it('пользователь того же вуза видит PUBLIC и UNIVERSITY', async () => {
    const { service, prisma } = setup({ universityId: 'uni-1' })
    await service.listForUser(viewer(), 'stu-1')
    expect(requestedVisibilities(prisma)).toEqual(['PUBLIC', 'UNIVERSITY'])
  })

  it('пользователь другого вуза видит только PUBLIC', async () => {
    const { service, prisma } = setup({ universityId: 'uni-1' })
    await service.listForUser(viewer({ universityId: 'uni-2' }), 'stu-1')
    expect(requestedVisibilities(prisma)).toEqual(['PUBLIC'])
  })

  it('работодатель без вуза видит только PUBLIC', async () => {
    const { service, prisma } = setup({ universityId: 'uni-1' })
    await service.listForUser(
      viewer({ sub: 'hr-1', role: Role.EMPLOYER, universityId: null, companyId: 'co-1' }),
      'stu-1',
    )
    expect(requestedVisibilities(prisma)).toEqual(['PUBLIC'])
  })

  it('два пользователя без вуза — не «один вуз»: только PUBLIC', async () => {
    const { service, prisma } = setup({ universityId: null })
    await service.listForUser(viewer({ universityId: null }), 'stu-1')
    expect(requestedVisibilities(prisma)).toEqual(['PUBLIC'])
  })

  it('владелец по тому же пути получает все свои записи без фильтра', async () => {
    const { service, prisma } = setup()
    await service.listForUser(viewer({ sub: 'stu-1' }), 'stu-1')
    expect(requestedVisibilities(prisma)).toBeUndefined()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('несуществующий пользователь — NOT_FOUND', async () => {
    const { service } = setup(null)
    await expect(service.listForUser(viewer(), 'nope')).rejects.toBeInstanceOf(AppException)
  })
})
