import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { UniversityService } from './universities.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    university: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    faculty: { count: jest.fn() },
    group: { count: jest.fn() },
    room: { count: jest.fn() },
    user: { count: jest.fn() },
    $transaction: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() }
  const service = new UniversityService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    redis as unknown as Redis,
  )
  return { service, prisma, audit, redis }
}

function viewer(role: Role, universityId: string | null = null, sub = 'u'): JwtPayload {
  return { sub, role, universityId, facultyId: null, groupId: null }
}

const UNI = { id: 'uni-1', name: 'Test', status: 'ACTIVE' }

describe('UniversityService — scope', () => {
  it('getById: платформа видит любой', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    await expect(service.getById(viewer(Role.PLATFORM_ADMIN), 'uni-1')).resolves.toEqual(UNI)
  })

  it('getById: свой вуз — ок, чужой — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    await expect(service.getById(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'uni-1')).resolves.toEqual(
      UNI,
    )

    prisma.university.findUnique.mockResolvedValue(UNI)
    await expect(
      service.getById(viewer(Role.UNIVERSITY_ADMIN, 'uni-2'), 'uni-1'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('getById: не найден → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(null)
    await expect(service.getById(viewer(Role.PLATFORM_ADMIN), 'x')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('getStats: модератор чужого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    await expect(
      service.getStats(viewer(Role.UNIVERSITY_MODERATOR, 'uni-2'), 'uni-1'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })
})

describe('UniversityService — status/create/delete', () => {
  it('create: пишет вуз и аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.university.create.mockResolvedValue({ ...UNI, name: 'Новый' })
    await service.create(viewer(Role.PLATFORM_ADMIN), { name: 'Новый' }, ctx)
    expect(prisma.university.create).toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'university_created' }),
    )
  })

  it('setStatus: меняет статус и аудит', async () => {
    const { service, prisma, audit } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    prisma.university.update.mockResolvedValue({ ...UNI, status: 'BLOCKED' })
    await service.setStatus(viewer(Role.PLATFORM_ADMIN), 'uni-1', { status: 'BLOCKED' }, ctx)
    expect(prisma.university.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'BLOCKED' } }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'university_status_changed' }),
    )
  })

  it('remove: FK-нарушение (P2003) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    prisma.university.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' }),
    )
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'uni-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})

describe('UniversityService — stats cache', () => {
  it('кэш-хит: возвращает из Redis без запросов в БД', async () => {
    const { service, prisma, redis } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    redis.get.mockResolvedValue(
      JSON.stringify({ faculties: 2, groups: 5, rooms: 3, students: 40, teachers: 8 }),
    )
    const stats = await service.getStats(viewer(Role.PLATFORM_ADMIN), 'uni-1')
    expect(stats).toEqual({ faculties: 2, groups: 5, rooms: 3, students: 40, teachers: 8 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('кэш-мисс: считает и кладёт в Redis с TTL', async () => {
    const { service, prisma, redis } = setup()
    prisma.university.findUnique.mockResolvedValue(UNI)
    redis.get.mockResolvedValue(null)
    prisma.$transaction.mockResolvedValue([1, 2, 3, 4, 5])
    const stats = await service.getStats(viewer(Role.PLATFORM_ADMIN), 'uni-1')
    expect(stats).toEqual({ faculties: 1, groups: 2, rooms: 3, students: 4, teachers: 5 })
    expect(redis.set).toHaveBeenCalledWith('stats:university:uni-1', expect.any(String), 'EX', 300)
  })
})

describe('UniversityService — list', () => {
  // Выборку и счётчик сервис отправляет одной транзакцией; мок возвращает их пару,
  // а проверяем аргументы, с которыми обратились к prisma.
  function listSetup() {
    const s = setup()
    s.prisma.$transaction.mockResolvedValue([[], 0])
    return s
  }
  const base = { page: 1, limit: 20 } as const

  it('без параметров: свежие сверху, без фильтра', async () => {
    const { service, prisma } = listSetup()
    await service.list({ ...base })
    expect(prisma.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' }, where: {}, skip: 0, take: 20 }),
    )
  })

  it('поиск идёт по названию и аббревиатуре без учёта регистра', async () => {
    const { service, prisma } = listSetup()
    await service.list({ ...base, search: 'Агро' })
    expect(prisma.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: 'Агро', mode: 'insensitive' } },
            { shortName: { contains: 'Агро', mode: 'insensitive' } },
          ],
        },
      }),
    )
  })

  it('сортировка берётся из запроса', async () => {
    const { service, prisma } = listSetup()
    await service.list({ ...base, sort: 'name', order: 'asc' })
    expect(prisma.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } }),
    )
  })

  it('сортировка без направления — по возрастанию', async () => {
    const { service, prisma } = listSetup()
    await service.list({ ...base, sort: 'status' })
    expect(prisma.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { status: 'asc' } }),
    )
  })

  it('страница считается от limit', async () => {
    const { service, prisma } = listSetup()
    await service.list({ page: 3, limit: 50 })
    expect(prisma.university.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50 }),
    )
  })

  // Главное в пагинации: счётчик обязан считать ту же выборку. Иначе таблица обещает
  // страницы, которых нет, — и наоборот, прячет существующие.
  it('счётчик считает по тем же фильтрам, что и выборка', async () => {
    const { service, prisma } = listSetup()
    await service.list({ ...base, search: 'Агро', status: 'ACTIVE' })
    const where = prisma.university.findMany.mock.calls[0][0].where
    expect(prisma.university.count).toHaveBeenCalledWith({ where })
    expect(where.status).toBe('ACTIVE')
  })
})
