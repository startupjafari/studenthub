import { Role } from '@studenthub/shared-types'
import { PORTFOLIO_MAX_ITEMS } from '@studenthub/shared-schemas'
import { PortfolioService, portfolioVisibilityWhere } from './portfolio.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { UserService } from '../users/users.service'

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

type Owner = { universityId: string | null; deletedAt?: Date | null }

function setup(
  owner: Owner | null = { universityId: 'uni-1' },
  opts: { canView?: boolean; items?: { id: string; order: number }[] } = {},
) {
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(owner ? { id: 'stu-1', deletedAt: null, ...owner } : null),
    },
    portfolioItem: {
      findMany: jest.fn().mockResolvedValue(opts.items ?? []),
      count: jest.fn().mockResolvedValue(opts.items?.length ?? 0),
      create: jest.fn().mockResolvedValue({ id: 'new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(0),
  }
  // Интерактивная транзакция — тот же мок: лок и запросы видны в одном месте.
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const users = { canViewProfileContentOf: jest.fn().mockResolvedValue(opts.canView ?? true) }
  const service = new PortfolioService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    users as unknown as UserService,
  )
  return { service, prisma, users }
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

  it('удалённый аккаунт — NOT_FOUND, записи не читаются (E-F24)', async () => {
    const { service, prisma } = setup({ universityId: 'uni-1', deletedAt: new Date() })
    await expect(service.listForUser(viewer(), 'stu-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prisma.portfolioItem.findMany).not.toHaveBeenCalled()
  })

  it('закрытый для смотрящего профиль — пустой список, записи не читаются (E-F24)', async () => {
    const { service, prisma, users } = setup({ universityId: 'uni-1' }, { canView: false })
    await expect(service.listForUser(viewer(), 'stu-1')).resolves.toEqual([])
    expect(users.canViewProfileContentOf).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'stu-2' }),
      expect.objectContaining({ id: 'stu-1' }),
    )
    expect(prisma.portfolioItem.findMany).not.toHaveBeenCalled()
  })
})

describe('PortfolioService — потолок записей', () => {
  it('на потолке новая запись не создаётся, подсчёт идёт под локом владельца', async () => {
    const { service, prisma } = setup()
    prisma.portfolioItem.count.mockResolvedValue(PORTFOLIO_MAX_ITEMS)
    await expect(
      service.create(viewer(), { kind: 'PROJECT', title: 'X' }, {}),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled()
  })

  it('ниже потолка запись создаётся', async () => {
    const { service, prisma } = setup()
    prisma.portfolioItem.count.mockResolvedValue(PORTFOLIO_MAX_ITEMS - 1)
    await service.create(viewer(), { kind: 'PROJECT', title: 'X' }, {})
    expect(prisma.portfolioItem.create).toHaveBeenCalledTimes(1)
  })
})

describe('PortfolioService — перестановка (E-F24)', () => {
  const items = [
    { id: 'a', order: 0 },
    { id: 'b', order: 0 },
    { id: 'c', order: 0 },
  ]

  /** Какой order получила каждая запись. */
  function orders(prisma: ReturnType<typeof setup>['prisma']): Record<string, number> {
    return Object.fromEntries(
      prisma.portfolioItem.update.mock.calls.map(([args]) => {
        const { where, data } = args as { where: { id: string }; data: { order: number } }
        return [where.id, data.order]
      }),
    )
  }

  it('перечисленные встают первыми, остальные — следом в прежнем порядке', async () => {
    const { service, prisma } = setup(undefined, { items })
    await service.reorder(viewer(), { ids: ['c'] })
    // У c order уже 0 — его позиция не перезаписывается.
    expect(orders(prisma)).toEqual({ a: 1, b: 2 })
  })

  it('полный порядок проставляется подряд, неизменённые позиции не пишутся', async () => {
    const { service, prisma } = setup(undefined, {
      items: [
        { id: 'a', order: 0 },
        { id: 'b', order: 1 },
        { id: 'c', order: 2 },
      ],
    })
    await service.reorder(viewer(), { ids: ['b', 'a', 'c'] })
    expect(orders(prisma)).toEqual({ b: 0, a: 1 })
  })

  it('чужой id — BAD_REQUEST, ничего не пишется', async () => {
    const { service, prisma } = setup(undefined, { items })
    await expect(service.reorder(viewer(), { ids: ['a', 'zzz'] })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.portfolioItem.update).not.toHaveBeenCalled()
  })

  it('выборка своих записей — только по владельцу из JWT', async () => {
    const { service, prisma } = setup(undefined, { items })
    await service.reorder(viewer(), { ids: ['a'] })
    const args = prisma.portfolioItem.findMany.mock.calls[0]?.[0] as { where: unknown }
    expect(args.where).toEqual({ userId: 'stu-2' })
  })
})
