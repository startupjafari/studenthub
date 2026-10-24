import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import {
  AnalyticsReportService,
  REPORT_MAX_UNITS,
  REPORT_MIN_CELL,
  reportRange,
  suppressedGroups,
  type AnalyticsReport,
} from './analytics-report.service'
import { reportColumns, reportRows } from './analytics-report.export'
import { AppException } from '../../common/exceptions/app.exception'
import type { AuditService } from '../../common/audit/audit.service'
import type { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportRegistryService } from '../../common/export/export-registry.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const viewer = (role: Role, over: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'u-1',
  role,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
  ...over,
})

interface Call {
  sql: string
  values: unknown[]
}

/**
 * Сырой SQL роутится по тексту запроса (как в спеке отчёта карьеры): в расчёте их семь, и
 * подмена «по порядку» была бы хрупкой. Вложенные фрагменты Prisma.sql приходят значением,
 * а не строкой, — поэтому маркеры стоят во внешнем шаблоне.
 */
function rawRouter(rows: Record<string, unknown[]>, calls: Call[]) {
  return jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
    calls.push({ sql, values })
    const pick = (key: string) => Promise.resolve(rows[key] ?? [])
    if (sql.includes('AS size')) return pick('groups')
    if (sql.includes('AS students')) return pick('students')
    if (sql.includes('AS marks')) return pick('attendance')
    if (sql.includes('"gradeSum"')) return pick('grades')
    if (sql.includes('"examAbsent"')) return pick('exams')
    if (sql.includes('AS submissions')) return pick('submissions')
    if (sql.includes('FROM applications ap')) return pick('applications')
    if (sql.includes('FROM audit_logs al')) return pick('active')
    return Promise.resolve([])
  })
}

const DEFAULT_ROWS: Record<string, unknown[]> = {
  students: [
    { unitId: 'g1', students: 25n },
    { unitId: 'g2', students: 3n },
  ],
  attendance: [
    { unitId: 'g1', marks: 200n, absent: 40n, late: 10n, excused: 5n },
    { unitId: 'g2', marks: 30n, absent: 10n, late: 0n, excused: 0n },
  ],
  grades: [{ unitId: 'g1', gradeSum: 15, gradeN: 20n }],
  exams: [{ unitId: 'g1', passed: 20n, failed: 3n, examAbsent: 1n, retake: 1n }],
  submissions: [{ unitId: 'g1', submissions: 50n }],
  applications: [{ unitId: 'g1', submitted: 7n, closed: 5n, overdue: 1n }],
  active: [
    { unitId: 'g1', active: 22n },
    { unitId: 'g2', active: 3n },
  ],
}

function setup(
  opts: {
    rows?: Record<string, unknown[]>
    units?: Array<{ id: string; name: string }>
    faculty?: { universityId: string } | null
  } = {},
) {
  const calls: Call[] = []
  const units = opts.units ?? [
    { id: 'g1', name: 'ИС-21' },
    { id: 'g2', name: 'ИС-22' },
  ]
  const prisma = {
    $queryRaw: rawRouter(opts.rows ?? DEFAULT_ROWS, calls),
    university: {
      findMany: jest.fn().mockResolvedValue(units),
      findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }),
    },
    faculty: {
      findMany: jest.fn().mockResolvedValue(units),
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.faculty === undefined ? { universityId: 'uni-1' } : opts.faculty),
    },
    group: { findMany: jest.fn().mockResolvedValue(units) },
    user: { findFirst: jest.fn().mockResolvedValue({ firstName: 'Асан', lastName: 'Асанов' }) },
  }
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const audit = { record: jest.fn() }
  const exports = { register: jest.fn().mockResolvedValue({ id: 'e1', shortId: 'ABC' }) }
  const branding = {
    labels: jest.fn().mockReturnValue({}),
    infoRows: jest.fn().mockReturnValue([]),
    sheetMetadata: jest.fn().mockReturnValue({}),
    filename: jest.fn().mockReturnValue('studenthub_analytics-report_2026-10-23.csv'),
  }
  const service = new AnalyticsReportService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    branding as unknown as ExportBrandingService,
    exports as unknown as ExportRegistryService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis, audit, exports, calls }
}

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof AppException ? error.code : 'NOT_APP_EXCEPTION'
  }
}

describe('AnalyticsReportService — область по роли из токена', () => {
  it('платформенная роль без факультета — вся платформа', async () => {
    const { service } = setup()
    const scope = await service.resolveScope(
      viewer(Role.PLATFORM_ADMIN, { universityId: null }),
      undefined,
    )
    expect(scope).toEqual({ level: 'platform', id: null, universityId: null })
  })

  it('админ вуза — свой вуз из токена', async () => {
    const { service } = setup()
    const scope = await service.resolveScope(viewer(Role.UNIVERSITY_ADMIN))
    expect(scope).toEqual({ level: 'university', id: 'uni-1', universityId: 'uni-1' })
  })

  it('админ вуза с факультетом своего вуза — отчёт факультета', async () => {
    const { service } = setup()
    const scope = await service.resolveScope(viewer(Role.UNIVERSITY_ADMIN), 'fac-1')
    expect(scope).toEqual({ level: 'faculty', id: 'fac-1', universityId: 'uni-1' })
  })

  it('факультет чужого вуза — WRONG_SCOPE', async () => {
    const { service } = setup({ faculty: { universityId: 'uni-7' } })
    expect(await codeOf(service.resolveScope(viewer(Role.UNIVERSITY_ADMIN), 'fac-9'))).toBe(
      'WRONG_SCOPE',
    )
  })

  it('несуществующий факультет — NOT_FOUND', async () => {
    const { service } = setup({ faculty: null })
    expect(await codeOf(service.resolveScope(viewer(Role.PLATFORM_ADMIN), 'nope'))).toBe(
      'NOT_FOUND',
    )
  })

  it('декан получает свой факультет, даже если просит чужой', async () => {
    const { service, prisma } = setup()
    const scope = await service.resolveScope(
      viewer(Role.DEAN, { facultyId: 'fac-own' }),
      'fac-foreign',
    )
    expect(scope).toEqual({ level: 'faculty', id: 'fac-own', universityId: 'uni-1' })
    expect(prisma.faculty.findUnique).not.toHaveBeenCalled()
  })

  it('декан без факультета — NOT_FOUND', async () => {
    const { service } = setup()
    expect(await codeOf(service.resolveScope(viewer(Role.DEAN)))).toBe('NOT_FOUND')
  })

  it('преподаватель — свои курсы; сузить до факультета нельзя', async () => {
    const { service } = setup()
    expect(await service.resolveScope(viewer(Role.TEACHER, { sub: 't-1' }))).toEqual({
      level: 'teacher',
      id: 't-1',
      universityId: 'uni-1',
    })
    expect(await codeOf(service.resolveScope(viewer(Role.TEACHER), 'fac-1'))).toBe('FORBIDDEN')
  })

  it('студент — FORBIDDEN', async () => {
    const { service } = setup()
    expect(await codeOf(service.resolveScope(viewer(Role.STUDENT)))).toBe('FORBIDDEN')
  })

  it('админ вуза без вуза в токене — WRONG_SCOPE', async () => {
    const { service } = setup()
    expect(
      await codeOf(service.resolveScope(viewer(Role.UNIVERSITY_ADMIN, { universityId: null }))),
    ).toBe('WRONG_SCOPE')
  })
})

describe('AnalyticsReportService — расчёт', () => {
  const facultyScope = { level: 'faculty' as const, id: 'fac-1', universityId: 'uni-1' }

  it('группа меньше порога выгружается без чисел, о сокрытии сообщается', async () => {
    const { service } = setup()
    const report = await service.build(facultyScope, 'quarter')
    const [big, small] = report.units
    expect(big?.suppressed).toBe(false)
    expect(big?.metrics?.attendance).toEqual({
      marks: 200,
      rate: 80,
      absent: 40,
      late: 10,
      excused: 5,
    })
    expect(big?.metrics?.grades).toEqual({ count: 20, avg: 75 })
    // «Трое студентов, посещаемость 67 %» — это сведения о людях, а не агрегат.
    expect(small).toEqual({
      id: 'g2',
      name: 'ИС-22',
      suppressed: true,
      partial: false,
      metrics: null,
    })
    expect(report.suppressed).toBe(1)
    expect(report.minCell).toBe(REPORT_MIN_CELL)
  })

  it('одна скрытая группа не вычисляется разностью: итог без неё и с пометкой', async () => {
    const { service } = setup()
    const report = await service.build(facultyScope, 'quarter')
    expect(report.total?.partial).toBe(true)
    expect(report.total?.metrics.students).toBe(25)
    expect(report.total?.metrics.attendance.marks).toBe(200)
  })

  it('скрытые вместе не меньше порога — итог по всей области', async () => {
    const { service } = setup({
      units: [
        { id: 'g1', name: 'A' },
        { id: 'g2', name: 'B' },
        { id: 'g3', name: 'C' },
      ],
      rows: {
        ...DEFAULT_ROWS,
        students: [
          { unitId: 'g1', students: 25n },
          { unitId: 'g2', students: 3n },
          { unitId: 'g3', students: 4n },
        ],
      },
    })
    const report = await service.build(facultyScope, 'quarter')
    expect(report.suppressed).toBe(2)
    expect(report.total?.partial).toBe(false)
    expect(report.total?.metrics.students).toBe(32)
    expect(report.total?.metrics.attendance.marks).toBe(230)
  })

  it('во всей области меньше порога — итога нет', async () => {
    const { service } = setup({
      units: [{ id: 'g2', name: 'ИС-22' }],
      rows: { ...DEFAULT_ROWS, students: [{ unitId: 'g2', students: 3n }] },
    })
    const report = await service.build(facultyScope, 'quarter')
    expect(report.total).toBeNull()
  })

  it('подразделение без отметок — посещаемость null, а не ноль процентов', async () => {
    const { service } = setup({
      units: [{ id: 'g1', name: 'ИС-21' }],
      rows: { students: [{ unitId: 'g1', students: 10n }] },
    })
    const report = await service.build(facultyScope, 'quarter')
    expect(report.units[0]?.metrics?.attendance.rate).toBeNull()
    expect(report.units[0]?.metrics?.grades.avg).toBeNull()
  })

  it('строк больше потолка — честный отказ, а не обрезанный файл', async () => {
    const units = Array.from({ length: REPORT_MAX_UNITS + 1 }, (_, i) => ({
      id: `g${i}`,
      name: `G${i}`,
    }))
    const { service } = setup({ units })
    expect(await codeOf(service.build(facultyScope, 'quarter'))).toBe('BAD_REQUEST')
  })

  it('период уходит в SQL границами: учебный год — с 1 сентября', async () => {
    const { service, calls } = setup()
    await service.build(facultyScope, 'year')
    const attendance = calls.find((c) => c.sql.includes('AS marks'))
    const from = attendance?.values.find((v) => v instanceof Date) as Date
    expect(from.getUTCMonth()).toBe(8)
    expect(from.getUTCDate()).toBe(1)
  })

  it('факультет фильтруется своим id — значение плейсхолдером, а не строкой', async () => {
    const { service, calls } = setup()
    await service.build(facultyScope, 'quarter')
    const students = calls.find((c) => c.sql.includes('AS students'))
    expect(JSON.stringify(students?.values)).toContain('fac-1')
    expect(students?.sql).not.toContain('fac-1')
  })

  it('у преподавателя только его пары и курсы, без заявок и активности', async () => {
    const { service, calls } = setup()
    const report = await service.build(
      { level: 'teacher', id: 't-1', universityId: 'uni-1' },
      'month',
    )
    expect(calls.some((c) => c.sql.includes('FROM applications ap'))).toBe(false)
    expect(calls.some((c) => c.sql.includes('FROM audit_logs al'))).toBe(false)
    const attendance = calls.find((c) => c.sql.includes('AS marks'))
    // Фильтр по преподавателю — вложенный фрагмент с его id.
    expect(JSON.stringify(attendance?.values)).toContain('t-1')
    expect(report.units[0]?.metrics?.applications).toBeNull()
    expect(report.units[0]?.metrics?.activeStudents).toBeNull()
  })

  it('готовый отчёт берётся из кэша и не идёт в базу', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockResolvedValue(JSON.stringify({ cached: true }))
    const report = await service.build(facultyScope, 'quarter')
    expect(report).toEqual({ cached: true })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('кэш разведён по уровню, области и периоду', async () => {
    const { service, redis } = setup()
    await service.build(facultyScope, 'month')
    await service.build({ level: 'faculty', id: 'fac-2', universityId: 'uni-1' }, 'month')
    await service.build({ level: 'platform', id: null, universityId: null }, 'year')
    expect(redis.get.mock.calls.map((c) => c[0])).toEqual([
      'analytics:report:faculty:fac-1:month',
      'analytics:report:faculty:fac-2:month',
      'analytics:report:platform:all:year',
    ])
  })

  it('Redis недоступен — отчёт считается напрямую', async () => {
    const { service, redis } = setup()
    redis.get.mockRejectedValue(new Error('down'))
    redis.set.mockRejectedValue(new Error('down'))
    const report = await service.build(facultyScope, 'quarter')
    expect(report.units).toHaveLength(2)
  })

  it('персональных данных в отчёте нет — только агрегаты', async () => {
    const { service } = setup()
    const serialized = JSON.stringify(await service.build(facultyScope, 'quarter'))
    expect(serialized).not.toContain('firstName')
    expect(serialized).not.toContain('email')
  })
})

describe('Вторичное подавление между уровнями (BUG-185)', () => {
  const g = (groupId: string, facultyId: string, students: number, universityId = 'uni-1') => ({
    groupId,
    facultyId,
    universityId,
    students,
  })

  it('строка факультета в отчёте вуза — без скрытых групп, как итог отчёта факультета', () => {
    // В отчёте факультета F группа на 3 студента скрыта, а итог посчитан без неё. Если
    // строка F в отчёте вуза её включает, «строка F минус видимые группы» = эта группа.
    const { excluded, partialUnits } = suppressedGroups(
      [g('big', 'F', 25), g('small', 'F', 3), g('other', 'G', 30)],
      'university',
    )
    expect(excluded).toEqual(['small'])
    expect([...partialUnits]).toEqual(['F'])
  })

  it('скрытые группы вместе не меньше порога — факультет считается целиком', () => {
    const { excluded, partialUnits } = suppressedGroups(
      [g('big', 'F', 25), g('a', 'F', 3), g('b', 'F', 4)],
      'university',
    )
    expect(excluded).toEqual([])
    expect(partialUnits.size).toBe(0)
  })

  it('в отчёте платформы вуз — без скрытых групп и без скрытых факультетов', () => {
    const { excluded, partialUnits } = suppressedGroups(
      [
        g('big', 'F', 25),
        g('small', 'F', 2),
        // Факультет на троих: в отчёте вуза он скрыт, а итог вуза посчитан без него.
        g('tiny', 'H', 3),
      ],
      'platform',
    )
    expect(excluded.sort()).toEqual(['small', 'tiny'])
    expect([...partialUnits]).toEqual(['uni-1'])
  })

  it('исключённые группы уходят в SQL параметром, строка помечена неполной', async () => {
    const { service, calls } = setup({
      units: [
        { id: 'F', name: 'Инженерный' },
        { id: 'G', name: 'Экономический' },
      ],
      rows: {
        groups: [
          { groupId: 'big', facultyId: 'F', universityId: 'uni-1', size: 25n },
          { groupId: 'small', facultyId: 'F', universityId: 'uni-1', size: 3n },
          { groupId: 'other', facultyId: 'G', universityId: 'uni-1', size: 30n },
        ],
        students: [
          { unitId: 'F', students: 25n },
          { unitId: 'G', students: 30n },
        ],
      },
    })
    const report = await service.build(
      { level: 'university', id: 'uni-1', universityId: 'uni-1' },
      'quarter',
    )
    const students = calls.find((c) => c.sql.includes('AS students'))
    expect(JSON.stringify(students?.values)).toContain('small')
    expect(report.units.find((u) => u.id === 'F')?.partial).toBe(true)
    expect(report.units.find((u) => u.id === 'G')?.partial).toBe(false)
    expect(reportRows(report, 'ru')[0]?.note).toBe('Без скрытых подразделений')
  })

  it('отчёт факультета групп не исключает: подавление — только для сводных уровней', async () => {
    const { service, calls } = setup()
    await service.build({ level: 'faculty', id: 'fac-1', universityId: 'uni-1' }, 'quarter')
    expect(calls.some((c) => c.sql.includes('AS size'))).toBe(false)
  })
})

describe('AnalyticsReportService — выгрузка', () => {
  it('пишет AuditLog и DocumentExport без самих чисел', async () => {
    const { service, audit, exports } = setup()
    const out = await service.exportReport(
      viewer(Role.DEAN, { facultyId: 'fac-1' }),
      { period: 'quarter', format: 'csv' },
      'ru',
      { ip: '1.2.3.4' },
    )
    expect(out.filename).toContain('analytics-report')
    expect(typeof out.body).toBe('string')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'analytics_report_export',
        entity: 'Faculty',
        entityId: 'fac-1',
        metadata: expect.objectContaining({ format: 'csv', level: 'faculty', rows: 3 }),
      }),
    )
    const registered = exports.register.mock.calls[0]?.[0]
    expect(registered.context.kind).toBe('analytics-report')
    expect(registered.context.timezone).toBe('Asia/Almaty')
    expect(registered.rows).toBe(3)
    expect(registered.ip).toBe('1.2.3.4')
  })

  it('CSV: заголовки на языке выгрузки, скрытая строка — с пометкой и без чисел', async () => {
    const { service } = setup()
    const out = await service.exportReport(
      viewer(Role.DEAN, { facultyId: 'fac-1' }),
      { period: 'quarter', format: 'csv' },
      'en',
    )
    const lines = String(out.body)
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
    expect(lines[0]).toContain('Group')
    expect(lines[0]).toContain('Attendance, %')
    const hidden = lines.find((l) => l.includes('ИС-22'))
    expect(hidden).toContain('Hidden: fewer than 5 students')
    // Между названием и пометкой — только пустые клетки.
    const cells = (hidden ?? '').split('","')
    expect(cells.slice(1, -1).every((cell) => cell === '')).toBe(true)
  })
})

describe('Раскладка файла', () => {
  const report: AnalyticsReport = {
    level: 'teacher',
    scopeId: 't-1',
    period: 'month',
    from: '2026-09-23T00:00:00.000Z',
    to: '2026-10-23T00:00:00.000Z',
    minCell: 5,
    suppressed: 0,
    units: [],
    total: null,
  }

  it('у преподавателя нет колонок заявок и активности', () => {
    const headers = reportColumns('teacher', 'ru').map((c) => c.header)
    expect(headers).not.toContain('Заявок поступило')
    expect(headers).not.toContain('Активных студентов')
    expect(reportColumns('university', 'ru').map((c) => c.header)).toContain('Заявок поступило')
  })

  it('заголовок подразделения зависит от уровня', () => {
    expect(reportColumns('platform', 'ru')[0]?.header).toBe('Вуз')
    expect(reportColumns('university', 'kk')[0]?.header).toBe('Факультет')
    expect(reportColumns('faculty', 'en')[0]?.header).toBe('Group')
  })

  it('итог последней строкой, даже скрытый', () => {
    const rows = reportRows(report, 'ru')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('Итого')
    expect(rows[0]?.metrics).toBeNull()
  })
})

describe('Границы периода', () => {
  it('месяц и квартал — последние 30 и 90 дней', () => {
    const now = new Date('2026-10-23T12:00:00Z')
    expect(reportRange('month', now).from.toISOString()).toBe('2026-09-23T12:00:00.000Z')
    expect(reportRange('quarter', now).from.toISOString()).toBe('2026-07-25T12:00:00.000Z')
  })

  it('учебный год до сентября — прошлогодний', () => {
    expect(reportRange('year', new Date('2026-05-10T00:00:00Z')).from.toISOString()).toBe(
      '2025-09-01T00:00:00.000Z',
    )
    expect(reportRange('year', new Date('2026-09-02T00:00:00Z')).from.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })
})
