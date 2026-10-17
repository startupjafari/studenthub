import { Role } from '@studenthub/shared-types'
import { AnalyticsService } from './analytics.service'
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
  return {
    service: new AnalyticsService(prisma as unknown as PrismaService),
    prisma,
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
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', course: { groupId: 'g1' } },
          { id: 'a2', course: { groupId: 'g1' } },
          { id: 'a3', course: { groupId: 'g1' } },
        ]),
      },
    })
  }

  it('просрочка = задания группы минус сдачи студента', async () => {
    const raw = rawMock({
      'GROUP BY a.student_id': [],
      'count(DISTINCT s.assignment_id)': [{ studentId: 's1', done: 1n }],
      'sum(g.score': [],
    })
    const { service } = atRiskSetup(raw)

    const res = await service.atRiskStudents(dean)
    const byId = Object.fromEntries(res.students.map((s) => [s.studentId, s.reasons]))

    // Из трёх просроченных заданий s1 сдал одно, s2 — ни одного.
    expect(byId.s1).toEqual([{ kind: 'OVERDUE_ASSIGNMENTS', value: 2 }])
    expect(byId.s2).toEqual([{ kind: 'OVERDUE_ASSIGNMENTS', value: 3 }])
  })

  it('сдавший всё в список не попадает', async () => {
    const raw = rawMock({
      'GROUP BY a.student_id': [],
      'count(DISTINCT s.assignment_id)': [
        { studentId: 's1', done: 3n },
        { studentId: 's2', done: 5n },
      ],
      'sum(g.score': [],
    })
    const { service } = atRiskSetup(raw)

    const res = await service.atRiskStudents(dean)

    // Сдач больше, чем заданий, быть не может, но если так — это ноль просрочек, а не минус.
    expect(res.students).toHaveLength(0)
  })

  it('низкая посещаемость и низкий средний балл дают свои причины', async () => {
    const raw = rawMock({
      'GROUP BY a.student_id': [{ studentId: 's1', total: 10n, absent: 6n }],
      'count(DISTINCT s.assignment_id)': [
        { studentId: 's1', done: 3n },
        { studentId: 's2', done: 3n },
      ],
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
