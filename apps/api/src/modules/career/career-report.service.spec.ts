import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import {
  CareerReportService,
  academicYearStart,
  dropoff,
  graduationYear,
  rate,
  resolveRange,
} from './career-report.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { AuditService } from '../../common/audit/audit.service'
import type { ExportBrandingService } from '../../common/export/export-branding.service'
import type { ExportRegistryService } from '../../common/export/export-registry.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const staff = (universityId: string | null = 'uni-1'): JwtPayload => ({
  sub: 'adm-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId,
  facultyId: null,
  groupId: null,
})

/** Платформенная роль: своего вуза нет, область данных выбирается параметром. */
const platform: JwtPayload = {
  sub: 'plt-1',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}

// Сырой SQL проверен на реальной схеме (запросы исполняются). Здесь — логика вокруг него:
// границы периода, порог малых групп, корзины готовности и кэш. Мок роутится по тексту
// запроса: в одном отчёте их больше десяти, и подмена «по порядку» была бы хрупкой.
function rawRouter(over: Record<string, unknown[]> = {}) {
  return jest.fn((strings: TemplateStringsArray) => {
    const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
    if (sql.includes('AS applications'))
      return Promise.resolve([
        {
          applications: 100n,
          applications_prev: 80n,
          hired: 10n,
          hired_prev: 5n,
          vacancies: 4n,
          vacancies_prev: 4n,
          companies: 2n,
          companies_prev: 0n,
        },
      ])
    if (sql.includes('first_view'))
      return Promise.resolve([
        { first_response_hours: 11.6, hire_days: 4.2, silent: 20n, total: 100n },
      ])
    if (sql.includes('WITH depth'))
      return Promise.resolve([
        { submitted: 100n, viewed: 70n, shortlisted: 40n, interview: 20n, offer: 12n, hired: 10n },
      ])
    if (sql.includes('FROM faculties'))
      return Promise.resolve(
        over.faculties ?? [
          { id: 'f1', name: 'Инженерный', students: 300n, applied: 120n, hired: 12n },
          { id: 'f2', name: 'Крошечный', students: 3n, applied: 2n, hired: 1n },
        ],
      )
    if (sql.includes('FROM companies c'))
      return Promise.resolve([{ id: 'c1', name: 'Компания', applications: 40n, hired: 6n }])
    if (sql.includes("'employment' AS dim"))
      return Promise.resolve([
        { dim: 'employment', key: 'FULL_TIME', n: 4n },
        { dim: 'city', key: '', n: 2n },
        { dim: 'city', key: 'Алматы', n: 3n },
      ])
    if (sql.includes('offered_min'))
      return Promise.resolve([
        {
          offered_min: 225000,
          offered_max: 425000,
          desired_min: 150000,
          desired_max: 300000,
          currency: 'KZT',
        },
      ])
    if (sql.includes('AS dead')) return Promise.resolve([{ dead: 1n, shown: 6n }])
    if (sql.includes('width_bucket'))
      return Promise.resolve(
        over.readiness ?? [
          { bucket: 2, n: 10n },
          { bucket: 5, n: 3n },
        ],
      )
    if (sql.includes('event_participants p'))
      return Promise.resolve([{ bucket: new Date(), n: 7n }])
    if (sql.includes('FROM events e'))
      return Promise.resolve([
        { id: 'e1', title: 'Ярмарка', kind: 'CAREER_FAIR', starts_at: new Date(), n: 42n },
      ])
    return Promise.resolve([])
  })
}

function setup(raw: Record<string, unknown[]> = {}) {
  const prisma = {
    $queryRaw: rawRouter(raw),
    careerApplication: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'HIRED', _count: { _all: 10 } },
        { status: 'REJECTED', _count: { _all: 30 } },
        { status: 'WITHDRAWN', _count: { _all: 5 } },
        { status: 'SUBMITTED', _count: { _all: 55 } },
      ]),
      findMany: jest.fn().mockResolvedValue([{ studentId: 's1' }, { studentId: 's2' }]),
    },
    careerProfile: {
      groupBy: jest.fn().mockResolvedValue([{ employmentStatus: 'LOOKING', _count: { _all: 9 } }]),
      count: jest.fn().mockResolvedValue(120),
    },
    resume: { count: jest.fn().mockResolvedValue(17) },
    user: { count: jest.fn().mockResolvedValue(400), findFirst: jest.fn().mockResolvedValue(null) },
    university: { findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
  }
  const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') }
  const service = new CareerReportService(
    prisma as unknown as PrismaService,
    { record: jest.fn() } as unknown as AuditService,
    {} as unknown as ExportBrandingService,
    { register: jest.fn() } as unknown as ExportRegistryService,
    redis as unknown as Redis,
  )
  return { service, prisma, redis }
}

describe('CareerReportService', () => {
  it('считает только свой вуз — скоуп берётся из токена', async () => {
    const { service } = setup()
    await expect(service.forUniversity(staff(null), 'quarter')).rejects.toBeInstanceOf(AppException)
  })

  it('плитки отдают и период, и предыдущий — дельту считает экран', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    expect(report.totals.applications).toEqual({ value: 100, previous: 80 })
    expect(report.totals.companies).toEqual({ value: 2, previous: 0 })
  })

  it('медианы округляются, доля молчания считается от всех откликов периода', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    expect(report.timing.firstResponseHours).toBe(12)
    expect(report.timing.hireDays).toBe(4)
    expect(report.timing.silentShare).toBe(20)
  })

  it('потери считаются между соседними шагами воронки', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    // 100 отправлено, 70 просмотрено — на первом же шаге теряется 30.
    expect(report.funnel.dropoff[0]).toEqual({ from: 'SUBMITTED', lost: 30 })
  })

  it('факультет меньше порога не показывается, но о его сокрытии сообщается', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    // «Трое студентов, трудоустроен один» — это сведения о человеке, а не агрегат.
    expect(report.faculties.items.map((f) => f.name)).toEqual(['Инженерный'])
    expect(report.faculties.suppressed).toBe(1)
    expect(report.faculties.minCell).toBe(5)
  })

  it('пустой город не попадает в географию', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    expect(report.vacancyCuts.cities).toEqual([{ city: 'Алматы', count: 3 }])
  })

  it('корзина ровно 100 баллов сворачивается в последнюю, а не теряется', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    // width_bucket отдаёт 5 для значения на верхней границе.
    expect(report.students.readiness.buckets).toEqual([0, 10, 0, 3])
  })

  it('исходы за период считаются от поданных за период', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    expect(report.outcomes.total).toBe(100)
    expect(report.outcomes.active).toBe(55)
    expect(report.outcomes.rejectedShare).toBe(30)
  })

  it('готовый отчёт берётся из кэша и не идёт в базу', async () => {
    const { service, prisma, redis } = setup()
    redis.get.mockResolvedValue(JSON.stringify({ cached: true }))
    const report = await service.forUniversity(staff(), 'quarter')
    expect(report).toEqual({ cached: true })
    expect(prisma.careerApplication.groupBy).not.toHaveBeenCalled()
  })

  it('кэш разведён по вузу и периоду — иначе месяц подменял бы год', async () => {
    const { service, redis } = setup()
    await service.forUniversity(platform, 'month', 'uni-7')
    expect(redis.get).toHaveBeenCalledWith('analytics:career:report:uni-7:month')
  })

  it('сотрудник вуза не может запросить отчёт чужого вуза', async () => {
    const { service } = setup()
    // Скоуп берётся из токена; явно переданный чужой вуз — WRONG_SCOPE, а не «уточнение».
    await expect(service.forUniversity(staff('uni-1'), 'quarter', 'uni-7')).rejects.toBeInstanceOf(
      AppException,
    )
  })

  it('персональных данных в отчёте нет — только агрегаты', async () => {
    const { service } = setup()
    const report = await service.forUniversity(staff(), 'quarter')
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('firstName')
    expect(serialized).not.toContain('email')
  })
})

describe('Границы периода', () => {
  it('«учебный год» начинается 1 сентября, а не 1 января', () => {
    const range = resolveRange('year', new Date('2026-03-10T00:00:00.000Z'))
    // Март — это ещё учебный год, начавшийся в сентябре прошлого календарного.
    expect(range.from.toISOString()).toBe('2025-09-01T00:00:00.000Z')
    expect(range.previousFrom.toISOString()).toBe('2024-09-01T00:00:00.000Z')
  })

  it('после 1 сентября учебный год считается новым', () => {
    expect(academicYearStart(new Date('2026-09-13T00:00:00.000Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
  })

  it('месяц и квартал сдвигают предыдущий период ровно на свою длину', () => {
    const now = new Date('2026-09-13T00:00:00.000Z')
    const month = resolveRange('month', now)
    expect(month.from.toISOString()).toBe('2026-08-14T00:00:00.000Z')
    expect(month.previousFrom.toISOString()).toBe('2026-07-15T00:00:00.000Z')
    const quarter = resolveRange('quarter', now)
    expect(quarter.from.toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })

  it('выпускной курс — следующий календарный год после 1 сентября', () => {
    expect(graduationYear(new Date('2026-09-13T00:00:00.000Z'))).toBe(2027)
    expect(graduationYear(new Date('2026-03-13T00:00:00.000Z'))).toBe(2026)
  })
})

describe('Чистые помощники', () => {
  it('потери не уходят в минус на монотонной воронке', () => {
    const stages = { SUBMITTED: 10, VIEWED: 8, SHORTLISTED: 5, INTERVIEW: 3, OFFER: 2, HIRED: 1 }
    expect(dropoff(stages).every((d) => d.lost >= 0)).toBe(true)
    expect(dropoff(stages)).toHaveLength(5)
  })

  it('доля при нулевом знаменателе — null, а не ноль', () => {
    expect(rate(0, 0)).toBeNull()
    expect(rate(1, 4)).toBe(25)
  })
})
