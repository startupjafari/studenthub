import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { AnalyticsService } from './analytics.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Агрегаты факультета считает Postgres (Ф13.6): раньше посещаемость, сдачи и оценки
// приезжали в Node целиком и сворачивались в Map'ы. Эти тесты закрывают стык —
// правильно ли сервис раскладывает свёрнутые базой строки и считает по ним причины
// риска. Сами запросы проверены на стенде сверкой со старой реализацией (PERF_BASELINE).

/** Мок `$queryRaw`: отвечает по куску SQL, который в него пришёл. */
function rawMock(byFragment: Record<string, unknown[]>) {
  return jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join(' ')
    for (const [fragment, rows] of Object.entries(byFragment)) {
      if (sql.includes(fragment)) return Promise.resolve(rows)
    }
    return Promise.resolve([])
  })
}

const dean: JwtPayload = {
  sub: 'd1',
  role: Role.DEAN,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: null,
}

function setup(raw: jest.Mock, over: Record<string, unknown> = {}) {
  const prisma = {
    $queryRaw: raw,
    group: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', name: 'ИТ-26-1' }]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    submission: { count: jest.fn().mockResolvedValue(0) },
    exam: { count: jest.fn().mockResolvedValue(0) },
    assignment: { findMany: jest.fn().mockResolvedValue([]) },
    faculty: { findUnique: jest.fn().mockResolvedValue({ id: 'fac-1', universityId: 'uni-1' }) },
    ...over,
  }
  // Кэш — настоящий словарь, а не заглушка «всегда промах»: так тесты кэша видят, что
  // именно записано и под каким ключом.
  const store = new Map<string, string>()
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    del: jest.fn(async (...keys: string[]) => keys.filter((k) => store.delete(k)).length),
  }
  return {
    service: new AnalyticsService(prisma as unknown as PrismaService, redis as unknown as Redis),
    prisma,
    redis,
    store,
  }
}

describe('AnalyticsService.facultyOverview — посещаемость из агрегата', () => {
  it('доля факультета складывается из групп, а не считается по строкам', async () => {
    const raw = rawMock({
      'GROUP BY p.group_id': [{ groupId: 'g1', total: 100n, absent: 10n }],
    })
    const { service } = setup(raw, {
      user: { findMany: jest.fn().mockResolvedValue([{ groupId: 'g1' }, { groupId: 'g1' }]) },
    })

    const res = await service.facultyOverview(dean)

    expect(res.totals.attendanceRate).toBe(90)
    expect(res.groups[0]).toMatchObject({
      groupId: 'g1',
      students: 2,
      attendanceRate: 90,
      attendanceTracked: 100,
    })
  })

  it('группа без отметок не ломает расчёт и не попадает в «требует внимания»', async () => {
    const raw = rawMock({ 'GROUP BY p.group_id': [] })
    const { service } = setup(raw)

    const res = await service.facultyOverview(dean)

    expect(res.totals.attendanceRate).toBe(0)
    expect(res.groups).toEqual([expect.objectContaining({ attendanceTracked: 0 })])
    expect(res.atRisk).toHaveLength(0)
  })
})

describe('AnalyticsService.atRiskStudents — причины риска', () => {
  const students = [
    { id: 's1', firstName: 'Асем', lastName: 'Абишева', groupId: 'g1' },
    { id: 's2', firstName: 'Ержан', lastName: 'Бектуров', groupId: 'g1' },
  ]

  function atRiskSetup(raw: jest.Mock) {
    return setup(raw, {
      user: { findMany: jest.fn().mockResolvedValue(students) },
    })
  }

  it('просрочки — несданные задания своей группы, посчитанные базой (BUG-193)', async () => {
    const raw = rawMock({
      'GROUP BY a.student_id': [],
      'NOT EXISTS': [{ studentId: 's1', overdue: 2n }],
      'sum(g.score': [],
    })
    const { service, prisma } = atRiskSetup(raw)

    const res = await service.atRiskStudents(dean)
    const byId = Object.fromEntries(res.students.map((s) => [s.studentId, s.reasons]))

    expect(byId.s1).toEqual([{ kind: 'OVERDUE_ASSIGNMENTS', value: 2 }])
    // Нет строки — нет просрочек: s2 всё сдал и в список не попал.
    expect(byId.s2).toBeUndefined()
    // Задания в Node не читаются: прежний findMany с потолком брал случайную их часть.
    expect(prisma.assignment.findMany).not.toHaveBeenCalled()
  })

  it('просрочки сверяются с текущей группой студента, а не со всем факультетом', async () => {
    const raw = rawMock({})
    const { service } = atRiskSetup(raw)

    await service.atRiskStudents(dean)

    const sql = raw.mock.calls
      .map((c) => (c[0] as TemplateStringsArray).join(' '))
      .find((q) => q.includes('NOT EXISTS'))
    expect(sql).toContain('c.group_id = u.group_id')
    expect(sql).toContain('s.student_id = u.id')
  })

  it('низкая посещаемость и низкий средний балл дают свои причины', async () => {
    const raw = rawMock({
      'GROUP BY a.student_id': [{ studentId: 's1', total: 10n, absent: 6n }],
      'NOT EXISTS': [],
      'sum(g.score': [{ studentId: 's1', sumPct: 0.8, n: 2n }],
    })
    const { service } = atRiskSetup(raw)

    const res = await service.atRiskStudents(dean)
    const s1 = res.students.find((s) => s.studentId === 's1')

    // 4 из 10 присутствий — 40%, порог 60. Средний балл 0.8/2 = 40%, порог 50.
    expect(s1?.reasons).toEqual(
      expect.arrayContaining([
        { kind: 'LOW_ATTENDANCE', value: 40 },
        { kind: 'LOW_GRADES', value: 40 },
      ]),
    )
    expect(s1?.severity).toBe(2)
  })
})

describe('AnalyticsService.groupAttendance — drill-down из агрегата', () => {
  const students = [
    { id: 's1', firstName: 'Асем', lastName: 'Абишева' },
    { id: 's2', firstName: 'Ержан', lastName: 'Бектуров' },
  ]

  // Сырые отметки читать нельзя — шпион ловит возврат к findMany по attendance.
  const attendanceFindMany = jest.fn()

  function groupSetup(raw: jest.Mock) {
    return setup(raw, {
      user: { findMany: jest.fn().mockResolvedValue(students) },
      group: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
      },
      attendance: { findMany: attendanceFindMany },
    })
  }

  it('проценты считаются по свёрнутым базой строкам, отметки в Node не грузятся', async () => {
    // 30 000 отметок у s1 — больше прежнего потолка в 20 000: агрегат их не обрезает.
    const raw = rawMock({
      'p.group_id =': [{ studentId: 's1', total: 30_000n, absent: 3_000n }],
    })
    const { service } = groupSetup(raw)

    const res = await service.groupAttendance(dean, 'g1')

    expect(res.students).toEqual([
      {
        studentId: 's1',
        firstName: 'Асем',
        lastName: 'Абишева',
        attendanceRate: 90,
        tracked: 30_000,
      },
      // Без отметок — ноль отмеченных, а не пропуск строки.
      { studentId: 's2', firstName: 'Ержан', lastName: 'Бектуров', attendanceRate: 0, tracked: 0 },
    ])
    expect(attendanceFindMany).not.toHaveBeenCalled()
  })

  it('группа — подставляемое значение SQL, а не кусок строки', async () => {
    const raw = rawMock({ 'p.group_id =': [] })
    const { service } = groupSetup(raw)

    await service.groupAttendance(dean, 'g1')

    expect(raw.mock.calls[0]?.slice(1)).toEqual(['g1'])
  })

  it('чужой факультет декану не отдаётся', async () => {
    const raw = rawMock({})
    const { service } = setup(raw, {
      group: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ facultyId: 'fac-2', faculty: { universityId: 'uni-1' } }),
      },
    })

    await expect(service.groupAttendance(dean, 'g9')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(raw).not.toHaveBeenCalled()
  })
})

describe('AnalyticsService — модератор вуза (BUG-004)', () => {
  const moderator: JwtPayload = {
    sub: 'm1',
    role: Role.UNIVERSITY_MODERATOR,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
  }

  // Матрица §2.2: аналитика модератору вуза закрыта — даже своего вуза, а поимённые
  // сводки (ФИО, просрочки, оценки) тем более.
  it('обзор, Early Warning и drill-down своего вуза — FORBIDDEN, в базу не идём', async () => {
    const raw = rawMock({})
    const { service } = setup(raw, {
      group: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest
          .fn()
          .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
      },
    })

    await expect(service.facultyOverview(moderator, 'fac-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(service.atRiskStudents(moderator, 'fac-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(service.groupAttendance(moderator, 'g1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(raw).not.toHaveBeenCalled()
  })
})

describe('AnalyticsService — кэш обзора факультета и drill-down группы', () => {
  const admin: JwtPayload = {
    sub: 'a1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
  }
  const groupOf = (facultyId: string, universityId = 'uni-1') => ({
    findMany: jest.fn().mockResolvedValue([{ id: 'g1', name: 'ИТ-26-1' }]),
    findUnique: jest.fn().mockResolvedValue({ facultyId, faculty: { universityId } }),
  })

  it('второй вызов обзора берётся из кэша и в базу не идёт', async () => {
    const raw = rawMock({ 'GROUP BY p.group_id': [{ groupId: 'g1', total: 10n, absent: 1n }] })
    const { service, prisma, redis } = setup(raw)

    const first = await service.facultyOverview(dean)
    const second = await service.facultyOverview(dean)

    expect(second).toEqual(first)
    expect(raw).toHaveBeenCalledTimes(1)
    expect(prisma.group.findMany).toHaveBeenCalledTimes(1)
    expect(redis.set).toHaveBeenCalledWith(
      'analytics:faculty:overview:fac-1',
      expect.any(String),
      'EX',
      300,
    )
  })

  it('разные факультеты не пересекаются: ключ — проверенный факультет', async () => {
    const raw = rawMock({})
    const { service, redis } = setup(raw, {
      faculty: {
        findUnique: jest.fn().mockResolvedValue({ universityId: 'uni-1' }),
      },
    })

    await service.facultyOverview(admin, 'fac-1')
    await service.facultyOverview(admin, 'fac-2')

    expect(redis.set.mock.calls.map((c) => c[0])).toEqual([
      'analytics:faculty:overview:fac-1',
      'analytics:faculty:overview:fac-2',
    ])
    // Второй факультет посчитан заново, а не отдан из кэша первого.
    expect(raw.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('кэш не обходит проверку области: чужой факультет — отказ, даже если он в кэше', async () => {
    const raw = rawMock({})
    const { service, store } = setup(raw, {
      faculty: { findUnique: jest.fn().mockResolvedValue({ universityId: 'uni-7' }) },
    })
    store.set('analytics:faculty:overview:fac-9', JSON.stringify({ facultyId: 'fac-9' }))

    await expect(service.facultyOverview(admin, 'fac-9')).rejects.toBeInstanceOf(AppException)
  })

  it('drill-down группы кэшируется по группе, разные группы не пересекаются', async () => {
    const raw = rawMock({ 'p.group_id =': [] })
    const { service, prisma, redis } = setup(raw, {
      group: groupOf('fac-1'),
      user: { findMany: jest.fn().mockResolvedValue([]) },
    })

    await service.groupAttendance(dean, 'g1')
    await service.groupAttendance(dean, 'g1')
    await service.groupAttendance(dean, 'g2')

    expect(prisma.user.findMany).toHaveBeenCalledTimes(2)
    expect(redis.set.mock.calls.map((c) => c[0])).toEqual([
      'analytics:group:attendance:g1',
      'analytics:group:attendance:g2',
    ])
  })

  it('кэш группы не отдаётся декану чужого факультета', async () => {
    const raw = rawMock({})
    const { service, store } = setup(raw, { group: groupOf('fac-2') })
    store.set('analytics:group:attendance:g9', JSON.stringify({ groupId: 'g9', students: [] }))

    await expect(service.groupAttendance(dean, 'g9')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })

  it('сброс факультета удаляет обзор и, если передана, группу', async () => {
    const raw = rawMock({})
    const { service, store } = setup(raw)
    store.set('analytics:faculty:overview:fac-1', '{}')
    store.set('analytics:group:attendance:g1', '{}')
    store.set('analytics:faculty:overview:fac-2', '{}')

    await service.invalidateFaculty('fac-1', 'g1')

    expect([...store.keys()]).toEqual(['analytics:faculty:overview:fac-2'])
  })

  it('Redis недоступен — обзор считается напрямую, сброс не роняет вызывающего', async () => {
    const raw = rawMock({})
    const { service, redis } = setup(raw)
    redis.get.mockRejectedValue(new Error('down'))
    redis.set.mockRejectedValue(new Error('down'))
    redis.del.mockRejectedValue(new Error('down'))

    await expect(service.facultyOverview(dean)).resolves.toMatchObject({ facultyId: 'fac-1' })
    await expect(service.invalidateFaculty('fac-1')).resolves.toBeUndefined()
  })
})
