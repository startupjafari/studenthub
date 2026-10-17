import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { CareerAccessService, activeAccessWhere } from './career-access.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'

// Модель доступа работодателя — самое чувствительное место карьерного модуля: от неё
// зависит, кто видит студентов. Проверяем именно её, а не обвязку.

function setup(rows: Array<{ universityId: string; status: string; expiresAt: Date | null }> = []) {
  const prisma = {
    companyUniversityAccess: { findMany: jest.fn().mockResolvedValue(rows) },
  }
  // Кэш выключен: get всегда мимо, чтобы тест проверял решение по данным, а не по Redis.
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }
  const service = new CareerAccessService(
    prisma as unknown as PrismaService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis }
}

function employer(companyId: string | null = 'co-1'): JwtPayload {
  return {
    sub: 'u-1',
    role: Role.EMPLOYER,
    universityId: null,
    facultyId: null,
    groupId: null,
    companyId,
  }
}

const HOUR = 60 * 60 * 1000

describe('CareerAccessService — какие вузы видит компания', () => {
  it('одобренный бессрочный допуск даёт доступ', async () => {
    const { service } = setup([{ universityId: 'uni-1', status: 'APPROVED', expiresAt: null }])
    await expect(service.canAccessUniversity('co-1', 'uni-1')).resolves.toBe(true)
  })

  it('истёкший допуск доступа НЕ даёт', async () => {
    const { service } = setup([
      { universityId: 'uni-1', status: 'APPROVED', expiresAt: new Date(Date.now() - HOUR) },
    ])
    await expect(service.canAccessUniversity('co-1', 'uni-1')).resolves.toBe(false)
  })

  it('допуск с будущим сроком действует', async () => {
    const { service } = setup([
      { universityId: 'uni-1', status: 'APPROVED', expiresAt: new Date(Date.now() + HOUR) },
    ])
    await expect(service.canAccessUniversity('co-1', 'uni-1')).resolves.toBe(true)
  })

  it('вуз, в который заявка не подавалась, недоступен', async () => {
    const { service } = setup([{ universityId: 'uni-1', status: 'APPROVED', expiresAt: null }])
    await expect(service.canAccessUniversity('co-1', 'uni-2')).resolves.toBe(false)
  })

  it('выборка ограничена take — findMany без предела запрещён (§5.3)', async () => {
    const { service, prisma } = setup()
    await service.allowedUniversityIds('co-1')
    expect(prisma.companyUniversityAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: expect.any(Number) }),
    )
  })
})

describe('CareerAccessService — барьер запроса', () => {
  it('работодатель без допуска получает WRONG_SCOPE', async () => {
    const { service } = setup([])
    await expect(service.assertCanAccessUniversity(employer(), 'uni-1')).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('работодатель с допуском проходит', async () => {
    const { service } = setup([{ universityId: 'uni-1', status: 'APPROVED', expiresAt: null }])
    await expect(service.assertCanAccessUniversity(employer(), 'uni-1')).resolves.toBeUndefined()
  })

  it('платформенная роль проходит без обращения к допускам', async () => {
    const { service, prisma } = setup()
    const admin: JwtPayload = {
      sub: 'a-1',
      role: Role.PLATFORM_ADMIN,
      universityId: null,
      facultyId: null,
      groupId: null,
    }
    await expect(service.assertCanAccessUniversity(admin, 'uni-1')).resolves.toBeUndefined()
    expect(prisma.companyUniversityAccess.findMany).not.toHaveBeenCalled()
  })

  it('аккаунт работодателя без компании не пускается дальше', () => {
    const { service } = setup()
    expect(() => service.requireCompany(employer(null))).toThrow(AppException)
  })

  it('не-работодатель не может выдать себя за компанию', () => {
    const { service } = setup()
    const student: JwtPayload = {
      sub: 's-1',
      role: Role.STUDENT,
      universityId: 'uni-1',
      facultyId: null,
      groupId: null,
      companyId: 'co-1',
    }
    expect(() => service.requireCompany(student)).toThrow(AppException)
  })
})

describe('activeAccessWhere — правило «допуск действует» для Prisma', () => {
  it('совпадает с isAccessActive: одобрен и срок ещё не наступил', () => {
    const now = new Date('2026-10-17T12:00:00Z')
    expect(activeAccessWhere('uni-1', now)).toEqual({
      universityId: 'uni-1',
      status: 'APPROVED',
      // Строго больше: в момент истечения допуск уже не действует, как и в isAccessActive.
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    })
  })
})

describe('CareerAccessService — граница воронки откликов', () => {
  const now = new Date('2026-10-17T12:00:00Z')
  const at = (iso: string) => new Date(iso)

  function withRows(rows: Array<Record<string, unknown>>) {
    const ctx = setup()
    ctx.prisma.companyUniversityAccess.findMany.mockResolvedValue(
      rows.map((r) => ({ expiresAt: null, decidedAt: null, requestedAt: at('2026-01-01'), ...r })),
    )
    return ctx
  }

  it('вуз с действующим допуском — все отклики, без допуска — только поданные до его конца', async () => {
    const { service } = withRows([
      { universityId: 'uni-active', status: 'APPROVED', expiresAt: at('2027-01-01') },
      // Истёк, cron ещё не дошёл: граница — срок.
      { universityId: 'uni-expired', status: 'APPROVED', expiresAt: at('2026-10-01') },
      // Отозван вузом вручную: граница — момент решения.
      { universityId: 'uni-revoked', status: 'REVOKED', decidedAt: at('2026-09-01') },
      // Закрыт cron по сроку: срок сохранён и точнее момента обработки.
      {
        universityId: 'uni-cron',
        status: 'REVOKED',
        expiresAt: at('2026-08-01'),
        decidedAt: at('2026-08-01T00:40:00Z'),
      },
      // Повторная заявка после потери допуска: к её подаче допуска уже не было.
      { universityId: 'uni-again', status: 'REQUESTED', requestedAt: at('2026-07-01') },
    ])

    await expect(service.applicationScopeWhere('co-1', now)).resolves.toEqual({
      OR: [
        { universityId: { in: ['uni-active'] } },
        { universityId: 'uni-expired', createdAt: { lte: at('2026-10-01') } },
        { universityId: 'uni-revoked', createdAt: { lte: at('2026-09-01') } },
        { universityId: 'uni-cron', createdAt: { lte: at('2026-08-01') } },
        { universityId: 'uni-again', createdAt: { lte: at('2026-07-01') } },
      ],
    })
  })

  it('компания без единого допуска откликов не видит вовсе', async () => {
    const { service, prisma } = withRows([])
    await expect(service.applicationScopeWhere('co-1', now)).resolves.toEqual({ id: { in: [] } })
    expect(prisma.companyUniversityAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-1' }, take: expect.any(Number) }),
    )
  })
})

describe('CareerAccessService — кэш', () => {
  it('сброс кэша не падает, когда Redis недоступен', async () => {
    const { service, redis } = setup()
    redis.del.mockRejectedValueOnce(new Error('redis down'))
    // Отзыв допуска не должен упасть из-за кэша: источник истины — БД.
    await expect(service.invalidate('co-1')).resolves.toBeUndefined()
  })

  it('готовый ответ берётся из кэша без запроса в БД', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockResolvedValueOnce(JSON.stringify(['uni-7']))
    await expect(service.allowedUniversityIds('co-1')).resolves.toEqual(['uni-7'])
    expect(prisma.companyUniversityAccess.findMany).not.toHaveBeenCalled()
  })
})
