import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { UniversityAnalyticsService } from './university-analytics.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Сырой SQL исполняется на реальной схеме отдельно. Здесь — то, что вокруг него: scope из
// токена, сборка ответа из строк, взвешенная посещаемость и кэш.

const ADMIN: JwtPayload = {
  sub: 'u1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    submission: { count: jest.fn().mockResolvedValue(0) },
    exam: { count: jest.fn().mockResolvedValue(0) },
    room: { count: jest.fn().mockResolvedValue(0) },
  }
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const service = new UniversityAnalyticsService(
    prisma as unknown as PrismaService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis }
}

/** Текст SQL из вызова $queryRaw (шаблонная строка приходит массивом кусков). */
function sqlOf(call: unknown[]): string {
  return (call[0] as string[]).join('?')
}

describe('UniversityAnalyticsService.overview (B-F22)', () => {
  it('посещаемость вуза — по всем отметкам, а не среднее процентов групп', async () => {
    const { service, prisma } = setup()
    // Группа A: 10 отметок, 5 пропусков (50 %). Группа B: 990 отметок, 10 пропусков (99 %).
    // Среднее групп дало бы 75 %, а по отметкам — 98,5 → 99 %.
    prisma.$queryRaw.mockResolvedValueOnce([
      { groupId: 'a', name: 'A-1', facultyId: 'f1', total: 10n, absent: 5n, allTotal: 1000n, allAbsent: 15n }, // prettier-ignore
      { groupId: 'b', name: 'B-1', facultyId: 'f2', total: 990n, absent: 10n, allTotal: 1000n, allAbsent: 15n }, // prettier-ignore
    ])
    prisma.submission.count.mockResolvedValueOnce(7)
    prisma.exam.count.mockResolvedValueOnce(3)

    const res = await service.overview(ADMIN)

    expect(res.attendanceRate).toBe(99)
    expect(res.attendanceTracked).toBe(1000)
    expect(res.submissionsPending).toBe(7)
    expect(res.examsUpcoming).toBe(3)
    expect(res.groups.map((g) => [g.groupId, g.attendanceRate])).toEqual([
      ['a', 50],
      ['b', 99],
    ])
    // Ниже порога 60 % — только A.
    expect(res.atRisk).toEqual([{ groupId: 'a', name: 'A-1', attendanceRate: 50 }])
  })

  it('без отметок посещаемость — null, а не 0 %', async () => {
    const { service } = setup()
    const res = await service.overview(ADMIN)
    expect(res.attendanceRate).toBeNull()
    expect(res.groups).toEqual([])
    expect(res.atRisk).toEqual([])
  })

  it('один SQL на весь вуз со scope из токена и потолком на список групп', async () => {
    const { service, prisma } = setup()
    await service.overview(ADMIN)

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    const call = prisma.$queryRaw.mock.calls[0] as unknown[]
    expect(call).toContain('uni-1')
    expect(sqlOf(call)).toContain('LIMIT')
    // Итоги — оконной суммой до LIMIT, иначе вуз считался бы по сотне худших групп.
    expect(sqlOf(call)).toContain('OVER ()')
    expect(prisma.submission.count).toHaveBeenCalledWith({
      where: {
        status: 'SUBMITTED',
        assignment: { course: { group: { faculty: { universityId: 'uni-1' } } } },
      },
    })
  })

  it('кэшируется по вузу: повторное открытие дашборда не идёт в БД', async () => {
    const { service, prisma, redis } = setup()
    await service.overview(ADMIN)
    const [key, value] = redis.set.mock.calls[0] as [string, string]
    expect(key).toBe('analytics:university:overview:universityId=uni-1')

    redis.get.mockResolvedValueOnce(value)
    prisma.$queryRaw.mockClear()
    await service.overview(ADMIN)
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('без вуза в токене — отказ по scope', async () => {
    const { service } = setup()
    expect(() => service.overview({ ...ADMIN, universityId: null })).toThrow()
  })
})

describe('UniversityAnalyticsService.roomLoad (B-F22)', () => {
  it('считает только активные расписания, пары через неделю — половиной', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValueOnce([
      { day: 1, hour: 9, count: 2.5 },
      { day: 7, hour: 23, count: 1 },
    ])
    prisma.room.count.mockResolvedValueOnce(12)

    const res = await service.roomLoad(ADMIN)

    const sql = sqlOf(prisma.$queryRaw.mock.calls[0] as unknown[])
    expect(sql).toContain('s.is_active')
    expect(sql).toContain("week_type = 'BOTH'")
    expect(res.grid[0]?.[9]).toBe(2.5)
    expect(res.grid[6]?.[23]).toBe(1)
    expect(res.peak).toBe(2.5)
    expect(res.rooms).toBe(12)
  })
})

describe('UniversityAnalyticsService.attendanceTrend', () => {
  afterEach(() => jest.useRealTimers())

  it('ряд на факультет по всем неделям окна, пустая неделя — null (BUG-187)', async () => {
    // Среда 23.09.2026: окно в 4 недели — с понедельника 31.08 по неделю 21.09.
    jest.useFakeTimers({ now: new Date('2026-09-23T10:00:00Z') })
    const { service, prisma } = setup()
    const w = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
    prisma.$queryRaw.mockResolvedValueOnce([
      { faculty_id: 'f1', name: 'ФИТ', bucket: w('2026-09-07'), rate: 90 },
      { faculty_id: 'f2', name: 'ФЭ', bucket: w('2026-09-14'), rate: 70 },
      { faculty_id: 'f1', name: 'ФИТ', bucket: w('2026-09-14'), rate: 85 },
    ])

    const res = await service.attendanceTrend(ADMIN, 4)

    const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'].map((d) =>
      w(d).toISOString(),
    )
    expect(res.weeks).toBe(4)
    expect(res.from).toBe(weeks[0])
    // Факультет, начавший отмечать позже, стоит на своих неделях, а не сдвинут к началу.
    expect(res.series).toEqual([
      {
        facultyId: 'f1',
        name: 'ФИТ',
        points: [
          { at: weeks[0], value: null },
          { at: weeks[1], value: 90 },
          { at: weeks[2], value: 85 },
          { at: weeks[3], value: null },
        ],
      },
      {
        facultyId: 'f2',
        name: 'ФЭ',
        points: [
          { at: weeks[0], value: null },
          { at: weeks[1], value: null },
          { at: weeks[2], value: 70 },
          { at: weeks[3], value: null },
        ],
      },
    ])
    expect(prisma.$queryRaw.mock.calls[0]).toContain('uni-1')
  })

  it('число недель зажато в 1…52, а мусор даёт окно по умолчанию; окно — часть ключа кэша', async () => {
    const { service, redis } = setup()
    await expect(service.attendanceTrend(ADMIN, 500)).resolves.toMatchObject({ weeks: 52 })
    await expect(service.attendanceTrend(ADMIN, 0)).resolves.toMatchObject({ weeks: 1 })
    await expect(service.attendanceTrend(ADMIN, Number.NaN)).resolves.toMatchObject({ weeks: 12 })
    expect(redis.set.mock.calls.map((c) => c[0])).toEqual([
      'analytics:university:attendance-trend.v2:span=52&universityId=uni-1',
      'analytics:university:attendance-trend.v2:span=1&universityId=uni-1',
      'analytics:university:attendance-trend.v2:span=12&universityId=uni-1',
    ])
  })
})

describe('UniversityAnalyticsService — разрезы по факультетам', () => {
  it('структура посещаемости и исход экзаменов: bigint из базы отдаются числами', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { faculty_id: 'f1', name: 'ФИТ', present: 10n, late: 2n, absent: 3n, excused: 1n },
      ])
      .mockResolvedValueOnce([
        { faculty_id: 'f1', name: 'ФИТ', passed: 5n, failed: 1n, absent: 0n, retake: 2n },
      ])

    const breakdown = await service.attendanceBreakdown(ADMIN)
    const exams = await service.examResults(ADMIN)

    expect(breakdown.items).toEqual([
      { facultyId: 'f1', name: 'ФИТ', present: 10, late: 2, absent: 3, excused: 1 },
    ])
    expect(exams.items).toEqual([
      { facultyId: 'f1', name: 'ФИТ', passed: 5, failed: 1, absent: 0, retake: 2 },
    ])
    // Оба разреза — с потолком на число факультетов.
    for (const call of prisma.$queryRaw.mock.calls as unknown[][]) {
      expect(sqlOf(call)).toContain('LIMIT')
    }
  })
})

describe('UniversityAnalyticsService.roomLoad — границы сетки', () => {
  it('строки вне 7×24 отбрасываются, а не ломают матрицу', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValueOnce([
      { day: 0, hour: 9, count: 5 },
      { day: 8, hour: 9, count: 5 },
      { day: 3, hour: 24, count: 5 },
      { day: 3, hour: -1, count: 5 },
      { day: 3, hour: 10, count: 1 },
    ])

    const res = await service.roomLoad(ADMIN)

    expect(res.grid).toHaveLength(7)
    expect(res.grid.every((row) => row.length === 24)).toBe(true)
    expect(res.grid.flat().reduce((a, b) => a + b, 0)).toBe(1)
    expect(res.grid[2]?.[10]).toBe(1)
    expect(res.peak).toBe(1)
  })
})

describe('UniversityAnalyticsService.applicationsFlow', () => {
  it('по неделям окна: поступило, закрыто, закрыто с просрочкой — числами', async () => {
    const { service, prisma } = setup()
    const week = new Date('2026-10-05T00:00:00Z')
    prisma.$queryRaw.mockResolvedValueOnce([
      { bucket: week, submitted: 12n, closed: 9n, overdue: 2n },
    ])

    const res = await service.applicationsFlow(ADMIN, 1)

    expect(res).toEqual({
      weeks: 1,
      points: [{ at: week.toISOString(), submitted: 12, closed: 9, overdue: 2 }],
    })
    const call = prisma.$queryRaw.mock.calls[0] as unknown[]
    expect(call).toContain('uni-1')
    // Удалённые заявки в поток не попадают.
    expect(sqlOf(call)).toContain('deleted_at IS NULL')
  })
})

describe('UniversityAnalyticsService.invitesFunnel', () => {
  function withInvites(rows: { status: string; count: number }[]) {
    const ctx = setup()
    const groupBy = jest
      .fn()
      .mockResolvedValue(rows.map((r) => ({ status: r.status, _count: { _all: r.count } })))
    ;(ctx.prisma as Record<string, unknown>).invite = { groupBy }
    return { ...ctx, groupBy }
  }

  it('конверсия — доля принятых от всех выданных, вуз — из токена', async () => {
    const { service, groupBy } = withInvites([
      { status: 'USED', count: 30 },
      { status: 'PENDING', count: 50 },
      { status: 'EXPIRED', count: 15 },
      { status: 'REVOKED', count: 5 },
    ])

    const res = await service.invitesFunnel(ADMIN)

    expect(res).toEqual({
      total: 100,
      pending: 50,
      used: 30,
      expired: 15,
      revoked: 5,
      conversion: 30,
    })
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: 'uni-1' } }),
    )
  })

  it('без приглашений конверсия 0, а не деление на ноль', async () => {
    const { service } = withInvites([])
    await expect(service.invitesFunnel(ADMIN)).resolves.toMatchObject({ total: 0, conversion: 0 })
  })
})

describe('UniversityAnalyticsService — недоступный Redis', () => {
  it('дашборд считается напрямую, без кэша, а не падает', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    redis.set.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    prisma.submission.count.mockResolvedValueOnce(4)

    await expect(service.overview(ADMIN)).resolves.toMatchObject({ submissionsPending: 4 })
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })
})
