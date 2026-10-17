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
