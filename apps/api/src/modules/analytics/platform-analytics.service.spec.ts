import type Redis from 'ioredis'
import {
  PlatformActivityQuerySchema,
  PlatformRangeQuerySchema,
  PlatformTopActionsQuerySchema,
} from '@studenthub/shared-schemas'
import {
  PlatformAnalyticsService,
  countDaysByWeekday,
  resolveRange,
} from './platform-analytics.service'
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
    faculty: { count: jest.fn().mockResolvedValue(0) },
    group: { count: jest.fn().mockResolvedValue(0) },
    room: { count: jest.fn().mockResolvedValue(0) },
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
  /** Строка SQL: счётчики приходят bigint'ами, как их отдаёт Postgres. */
  function row(id: string, name: string, over: Record<string, unknown> = {}) {
    return {
      id,
      name,
      shortName: null,
      status: 'ACTIVE',
      city: null,
      students: 0n,
      teachers: 0n,
      total: 0n,
      faculties: 0n,
      groups: 0n,
      rooms: 0n,
      ...over,
    }
  }

  it('отдаёт счётчики вуза числами в порядке SQL — крупнейшие первыми', async () => {
    const { service } = setup([
      row('u2', 'Большой', {
        shortName: 'БГУ',
        city: '750000000',
        students: 105n,
        teachers: 20n,
        total: 130n,
        faculties: 4n,
        groups: 12n,
        rooms: 30n,
      }),
      row('u1', 'Малый', { students: 10n, total: 10n }),
    ])

    const res = await service.universitiesSize()

    expect(res.items.map((i) => i.name)).toEqual(['Большой', 'Малый'])
    expect(res.items[0]).toEqual({
      id: 'u2',
      name: 'Большой',
      shortName: 'БГУ',
      status: 'ACTIVE',
      city: '750000000',
      students: 105,
      teachers: 20,
      total: 130,
      faculties: 4,
      groups: 12,
      rooms: 30,
    })
    expect(res.items[1]).toMatchObject({ students: 10, teachers: 0, total: 10, groups: 0 })
  })

  it('итоги считаются по всей платформе, а не по обрезанному списку', async () => {
    const { service, prisma } = setup([row('u1', 'A', { students: 10n, total: 12n })])
    prisma.university.groupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 250 } },
      { status: 'PENDING', _count: { _all: 3 } },
    ])
    prisma.faculty.count.mockResolvedValue(900)
    prisma.group.count.mockResolvedValue(7000)
    prisma.room.count.mockResolvedValue(4000)
    prisma.user.groupBy.mockResolvedValue([
      { role: 'STUDENT', _count: { _all: 1000 } },
      { role: 'STAROSTA', _count: { _all: 50 } },
      { role: 'TEACHER', _count: { _all: 80 } },
      { role: 'DEAN', _count: { _all: 5 } },
    ])

    const res = await service.universitiesSize()

    // Староста считается со студентами — это студенческая роль.
    expect(res.totals).toEqual({
      universities: 253,
      active: 250,
      faculties: 900,
      groups: 7000,
      rooms: 4000,
      students: 1050,
      teachers: 80,
      total: 1135,
    })
  })

  it('один SQL на все вузы с потолком, а не запрос на каждый вуз', async () => {
    const { service, queryRaw, prisma } = setup([row('u1', 'A'), row('u2', 'B'), row('u3', 'C')])

    await service.universitiesSize()

    expect(queryRaw).toHaveBeenCalledTimes(1)
    // Потолок — подставляемое значение, а не кусок SQL (§14.4).
    expect(queryRaw.mock.calls[0]?.slice(1)).toContain(200)
    expect(prisma.university.findMany).not.toHaveBeenCalled()
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

  it('без зоны в запросе раскладка идёт по UTC', async () => {
    const { service } = setup([])
    const res = await service.activityHeatmap({ from: FROM, to: TO })
    expect(res.tz).toBe('UTC')
  })

  it('зона попадает в SQL и в ключ кэша — иначе Алматы читал бы UTC-картину', async () => {
    const { service, queryRaw, redis } = setup([])

    await service.activityHeatmap({ from: FROM, to: TO, tz: 'Asia/Almaty' })

    // $queryRaw получает шаблонную строку: зона приходит подставляемым значением,
    // а не куском SQL (BACKEND_RULES §14.4 — конкатенации в запросе нет).
    expect(queryRaw.mock.calls[0]?.slice(1)).toContain('Asia/Almaty')
    expect(redis.get.mock.calls[0]?.[0]).toContain('tz=Asia/Almaty')
  })

  it('считает даты каждого дня недели — делитель для будней и выходных', async () => {
    const { service } = setup([])
    const res = await service.activityHeatmap({ from: FROM, to: TO })
    // [1 авг 2026 00:00, 5 авг 00:00) — суббота, воскресенье, понедельник, вторник.
    expect(res.days).toEqual([1, 1, 0, 0, 0, 1, 1])
  })
})

describe('countDaysByWeekday', () => {
  it('правый край исключающий: полночь не добавляет лишних суток', () => {
    // [1 авг, 3 авг 00:00) — это суббота и воскресенье, но не понедельник.
    const days = countDaysByWeekday(
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-03T00:00:00.000Z'),
      'UTC',
    )
    expect(days).toEqual([0, 0, 0, 0, 0, 1, 1])
  })

  it('даты берутся в зоне читателя, а не в UTC', () => {
    // 2026-08-02 20:00 UTC — это уже 3 августа (понедельник) в Алматы (UTC+5).
    const from = new Date('2026-08-02T20:00:00.000Z')
    const to = new Date('2026-08-02T21:00:00.000Z')
    expect(countDaysByWeekday(from, to, 'UTC')).toEqual([0, 0, 0, 0, 0, 0, 1])
    expect(countDaysByWeekday(from, to, 'Asia/Almaty')).toEqual([1, 0, 0, 0, 0, 0, 0])
  })

  it('вывернутый период даёт нули, а не бесконечный цикл', () => {
    expect(countDaysByWeekday(TO, FROM, 'UTC')).toEqual([0, 0, 0, 0, 0, 0, 0])
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
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
    expect(prisma.university.groupBy).not.toHaveBeenCalled()
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
    const { service, redis } = setup()
    redis.get.mockRejectedValue(new Error('redis down'))
    redis.set.mockRejectedValue(new Error('redis down'))

    await expect(service.universitiesSize()).resolves.toMatchObject({
      items: [],
      totals: { universities: 0 },
    })
  })
})

describe('Период аналитики платформы — пределы (B-F21)', () => {
  const DAY = 86_400_000
  const NOW = new Date('2026-10-01T00:00:00.000Z')

  it('схема отклоняет период с 1970 года — 422 до похода в БД', () => {
    const res = PlatformRangeQuerySchema.safeParse({
      from: '1970-01-01',
      to: NOW.toISOString(),
      interval: 'day',
    })
    expect(res.success).toBe(false)
  })

  it('схема отклоняет `from` без `to`, если до «сейчас» слишком далеко', () => {
    expect(PlatformRangeQuerySchema.safeParse({ from: '1970-01-01' }).success).toBe(false)
  })

  it('схема отклоняет вывернутый и пустой период', () => {
    expect(
      PlatformRangeQuerySchema.safeParse({ from: TO.toISOString(), to: FROM.toISOString() })
        .success,
    ).toBe(false)
    expect(
      PlatformRangeQuerySchema.safeParse({ from: FROM.toISOString(), to: FROM.toISOString() })
        .success,
    ).toBe(false)
  })

  it('схема пропускает окна дашборда: 30 дней по дням и 13 недель по неделям', () => {
    expect(PlatformRangeQuerySchema.safeParse({}).success).toBe(true)
    expect(
      PlatformRangeQuerySchema.safeParse({
        from: new Date(NOW.getTime() - 30 * DAY).toISOString(),
        to: NOW.toISOString(),
        interval: 'day',
      }).success,
    ).toBe(true)
    expect(
      PlatformRangeQuerySchema.safeParse({
        from: new Date(NOW.getTime() - 91 * DAY).toISOString(),
        to: NOW.toISOString(),
        interval: 'week',
      }).success,
    ).toBe(true)
  })

  it('по дням — не больше года, по неделям и месяцам — не больше двух лет', () => {
    const range = (days: number, interval: string) => ({
      from: new Date(NOW.getTime() - days * DAY).toISOString(),
      to: NOW.toISOString(),
      interval,
    })
    expect(PlatformRangeQuerySchema.safeParse(range(366, 'day')).success).toBe(true)
    expect(PlatformRangeQuerySchema.safeParse(range(367, 'day')).success).toBe(false)
    expect(PlatformRangeQuerySchema.safeParse(range(731, 'month')).success).toBe(true)
    expect(PlatformRangeQuerySchema.safeParse(range(732, 'week')).success).toBe(false)
  })

  it('та же проверка стоит на топе действий и тепловой карте', () => {
    const abuse = { from: '1970-01-01', to: NOW.toISOString() }
    expect(PlatformTopActionsQuerySchema.safeParse({ ...abuse, limit: 5 }).success).toBe(false)
    expect(PlatformActivityQuerySchema.safeParse({ ...abuse, tz: 'Asia/Almaty' }).success).toBe(
      false,
    )
  })

  it('сервис режет период до SQL, даже если схему обошли', () => {
    const range = resolveRange({ from: new Date('1970-01-01T00:00:00.000Z'), to: NOW })
    expect(NOW.getTime() - range.from.getTime()).toBe(366 * DAY)
    expect(range.interval).toBe('day')
  })

  it('в SQL уходит уже обрезанный период, корзин — не больше года', async () => {
    const { service, queryRaw } = setup([])
    const res = await service.usersGrowth({
      from: new Date('1970-01-01T00:00:00.000Z'),
      to: NOW,
      interval: 'day',
    })

    const params = (queryRaw.mock.calls[0] as unknown[]).slice(1)
    const dates = params.filter((p): p is Date => p instanceof Date)
    expect(dates.every((d) => d.getUTCFullYear() >= 2025)).toBe(true)
    expect(res.series[0]?.points.length).toBeLessThanOrEqual(367)
  })

  it('вывернутый период сводится к пустому, а не к бесконечному', () => {
    const range = resolveRange({ from: TO, to: FROM })
    expect(range.from.getTime()).toBe(FROM.getTime())
    expect(range.to.getTime()).toBe(FROM.getTime())
  })
})
