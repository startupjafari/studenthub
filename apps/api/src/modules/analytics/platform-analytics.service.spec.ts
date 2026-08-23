import type Redis from 'ioredis'
import { PlatformAnalyticsService } from './platform-analytics.service'
import type { PrismaService } from '../../common/prisma/prisma.service'

// Сырой SQL проверен отдельно на реальной схеме (запросы исполняются). Здесь —
// логика вокруг него: раскладка плоских строк в ряды, досыпка нулевых корзин,
// границы периода и кэш.

function setup(rawRows: unknown[] = []) {
  const queryRaw = jest.fn().mockResolvedValue(rawRows)
  const prisma = {
    $queryRaw: queryRaw,
    university: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn() },
    user: { count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    complaint: { count: jest.fn().mockResolvedValue(0) },
    invite: { groupBy: jest.fn().mockResolvedValue([]) },
    auditLog: { groupBy: jest.fn().mockResolvedValue([]) },
  }
  // Кэш по умолчанию промахивается: тесты проверяют сам расчёт.
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const service = new PlatformAnalyticsService(
    prisma as unknown as PrismaService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis, queryRaw }
}

const FROM = new Date('2026-08-01T00:00:00.000Z')
const TO = new Date('2026-08-05T00:00:00.000Z')

describe('PlatformAnalyticsService.usersGrowth', () => {
  it('раскладывает строки по сериям и досыпает пустые корзины нулями', async () => {
    const { service } = setup([
      { bucket: new Date('2026-08-01T00:00:00.000Z'), series: 'students', count: 5n },
      { bucket: new Date('2026-08-03T00:00:00.000Z'), series: 'teachers', count: 2n },
    ])

    const res = await service.usersGrowth({ from: FROM, to: TO, interval: 'day' })

    expect(res.series.map((s) => s.key)).toEqual(['students', 'teachers', 'staff'])
    // 4 дня в периоде — у каждой серии ровно 4 точки, дыры нулями.
    expect(res.series.every((s) => s.points.length === 4)).toBe(true)
    expect(res.series[0]?.points.map((p) => p.value)).toEqual([5, 0, 0, 0])
    expect(res.series[1]?.points.map((p) => p.value)).toEqual([0, 0, 2, 0])
    expect(res.series[2]?.points.map((p) => p.value)).toEqual([0, 0, 0, 0])
  })

  it('серия остаётся в ответе, даже если данных по ней нет вообще', async () => {
    const { service } = setup([])
    const res = await service.usersGrowth({ from: FROM, to: TO, interval: 'day' })
    // Пропавшая серия сломала бы легенду и цвет: слот у серии фиксированный.
    expect(res.series).toHaveLength(3)
  })

  it('корзины недели начинаются с понедельника', async () => {
    const { service } = setup([])
    const res = await service.usersGrowth({
      // 2026-08-05 — среда; корзина обязана начаться в понедельник 2026-08-03.
      from: new Date('2026-08-05T12:00:00.000Z'),
      to: new Date('2026-08-12T00:00:00.000Z'),
      interval: 'week',
    })
    expect(res.series[0]?.points[0]?.at).toBe('2026-08-03T00:00:00.000Z')
  })

  it('период по умолчанию — последние 30 дней с шагом день', async () => {
    const { service } = setup([])
    const res = await service.usersGrowth({})
    expect(res.interval).toBe('day')
    const days = (Date.parse(res.to) - Date.parse(res.from)) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })
})

describe('PlatformAnalyticsService.overview', () => {
  it('собирает плитки и спарклайны фиксированной длины', async () => {
    const { service, prisma } = setup()
    prisma.university.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 3 } },
      { status: 'PENDING', _count: { _all: 1 } },
    ])
    prisma.user.count.mockResolvedValue(396)
    prisma.complaint.count.mockResolvedValue(7)

    const res = await service.overview()

    expect(res.universities).toEqual({ active: 3, pending: 1, blocked: 0 })
    expect(res.users.total).toBe(396)
    expect(res.complaints.pending).toBe(7)
    // Спарклайн всегда 14 точек — иначе плитки скачут по ширине.
    expect(res.users.spark).toHaveLength(14)
    expect(res.complaints.spark).toHaveLength(14)
    expect(res.activeUsers.spark).toHaveLength(14)
  })
})

describe('PlatformAnalyticsService.universitiesSize', () => {
  it('считает роли по вузам и сортирует по убыванию размера', async () => {
    const { service, prisma } = setup()
    prisma.university.findMany.mockResolvedValue([
      { id: 'u1', name: 'Малый', status: 'ACTIVE' },
      { id: 'u2', name: 'Большой', status: 'ACTIVE' },
    ])
    prisma.user.groupBy.mockResolvedValue([
      { universityId: 'u1', role: 'STUDENT', _count: { _all: 10 } },
      { universityId: 'u2', role: 'STUDENT', _count: { _all: 100 } },
      { universityId: 'u2', role: 'STAROSTA', _count: { _all: 5 } },
      { universityId: 'u2', role: 'TEACHER', _count: { _all: 20 } },
    ])

    const res = await service.universitiesSize()

    expect(res.items.map((i) => i.name)).toEqual(['Большой', 'Малый'])
    // Староста считается со студентами — это студенческая роль.
    expect(res.items[0]).toMatchObject({ students: 105, teachers: 20, total: 125 })
    expect(res.items[1]).toMatchObject({ students: 10, teachers: 0, total: 10 })
  })

  it('делает один запрос за пользователями, а не по вузу на каждый', async () => {
    const { service, prisma } = setup()
    prisma.university.findMany.mockResolvedValue([
      { id: 'u1', name: 'A', status: 'ACTIVE' },
      { id: 'u2', name: 'B', status: 'ACTIVE' },
      { id: 'u3', name: 'C', status: 'ACTIVE' },
    ])
    await service.universitiesSize()
    expect(prisma.user.groupBy).toHaveBeenCalledTimes(1)
  })
})

describe('PlatformAnalyticsService.activityHeatmap', () => {
  it('раскладывает строки в сетку 7×24 и находит максимум', async () => {
    const { service } = setup([
      { dow: 1, hour: 18, count: 6n },
      { dow: 6, hour: 13, count: 2n },
    ])

    const res = await service.activityHeatmap({ from: FROM, to: TO })

    expect(res.cells).toHaveLength(7)
    expect(res.cells.every((row) => row.length === 24)).toBe(true)
    // ISODOW 1 = понедельник → индекс 0.
    expect(res.cells[0]?.[18]).toBe(6)
    expect(res.cells[5]?.[13]).toBe(2)
    expect(res.max).toBe(6)
  })

  it('пустой период даёт нулевую сетку и max = 0', async () => {
    const { service } = setup([])
    const res = await service.activityHeatmap({ from: FROM, to: TO })
    expect(res.max).toBe(0)
    expect(res.cells.flat().every((v) => v === 0)).toBe(true)
  })
})

describe('PlatformAnalyticsService.invitesFunnel', () => {
  it('считает конверсию в регистрацию', async () => {
    const { service, prisma } = setup([])
    prisma.invite.groupBy.mockResolvedValue([
      { status: 'USED', _count: { _all: 30 } },
      { status: 'PENDING', _count: { _all: 10 } },
      { status: 'EXPIRED', _count: { _all: 10 } },
    ])

    const res = await service.invitesFunnel({ from: FROM, to: TO })

    expect(res.total).toBe(50)
    expect(res.used).toBe(30)
    expect(res.conversion).toBe(60)
    expect(res.byStatus.map((s) => s.key)).toEqual(['USED', 'PENDING', 'EXPIRED', 'REVOKED'])
  })

  it('без инвайтов конверсия 0, а не деление на ноль', async () => {
    const { service } = setup([])
    const res = await service.invitesFunnel({ from: FROM, to: TO })
    expect(res.total).toBe(0)
    expect(res.conversion).toBe(0)
  })
})

describe('PlatformAnalyticsService.complaintsLatency', () => {
  it('возвращает все корзины в фиксированном порядке', async () => {
    const { service, queryRaw } = setup()
    queryRaw
      .mockResolvedValueOnce([
        { bucket: 'lt1h', count: 3n },
        { bucket: 'gte7d', count: 1n },
      ])
      .mockResolvedValueOnce([{ median: 2.55 }])

    const res = await service.complaintsLatency({ from: FROM, to: TO })

    expect(res.buckets.map((b) => b.key)).toEqual(['lt1h', 'lt4h', 'lt1d', 'lt3d', 'lt7d', 'gte7d'])
    expect(res.buckets.map((b) => b.value)).toEqual([3, 0, 0, 0, 0, 1])
    expect(res.medianHours).toBe(2.6)
  })
})

describe('PlatformAnalyticsService — кэш', () => {
  it('попадание в кэш не идёт в БД', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockResolvedValue(JSON.stringify({ items: [] }))

    const res = await service.universitiesSize()

    expect(res).toEqual({ items: [] })
    expect(prisma.university.findMany).not.toHaveBeenCalled()
  })

  it('ключ кэша включает период — разные периоды не затирают друг друга', async () => {
    const { service, redis } = setup([])
    await service.usersGrowth({ from: FROM, to: TO, interval: 'day' })
    await service.usersGrowth({ from: FROM, to: TO, interval: 'week' })

    const keys = redis.set.mock.calls.map((c) => c[0] as string)
    expect(keys[0]).not.toEqual(keys[1])
    expect(keys[0]).toContain('interval=day')
    expect(keys[1]).toContain('interval=week')
  })

  it('недоступный Redis не ломает ответ', async () => {
    const { service, redis, prisma } = setup()
    redis.get.mockRejectedValue(new Error('redis down'))
    redis.set.mockRejectedValue(new Error('redis down'))
    prisma.university.findMany.mockResolvedValue([])

    await expect(service.universitiesSize()).resolves.toEqual({ items: [] })
  })
})
