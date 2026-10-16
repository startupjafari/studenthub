import { Role } from '@studenthub/shared-types'
import { ExamsService } from './exams.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

// Экзамен по дисциплине преподавателя `lecturer`, принимает его `examiner`.
const examRow = {
  id: 'ex-1',
  groupId: 'grp-1',
  examinerId: 'examiner',
  course: {
    teacherId: 'lecturer',
    group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
  },
}

function setup() {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue(examRow),
      update: jest.fn().mockResolvedValue({ id: 'ex-1' }),
      delete: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) },
    examResult: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

const teacher = (sub: string): JwtPayload => ({
  sub,
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
})

describe('ExamsService — ведомость ведёт экзаменатор', () => {
  it('экзаменатор, не читающий дисциплину, открывает ведомость', async () => {
    const { service } = setup()
    await expect(service.results(teacher('examiner'), 'ex-1')).resolves.toMatchObject({
      examId: 'ex-1',
    })
  })

  it('экзаменатор выставляет результаты', async () => {
    const { service, prisma } = setup()
    await service.setResults(
      teacher('examiner'),
      {
        examId: 'ex-1',
        entries: [{ studentId: 'st-1', admitted: true, status: 'PASSED', score: 85 }],
      },
      ctx,
    )
    expect(prisma.examResult.upsert).toHaveBeenCalled()
  })

  it('править сам экзамен экзаменатор не может — это за ведущим дисциплину', async () => {
    const { service, prisma } = setup()
    await expect(
      service.update(teacher('examiner'), 'ex-1', { note: 'перенос' }, ctx),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(prisma.exam.update).not.toHaveBeenCalled()
  })

  it('посторонний преподаватель ведомость не получает', async () => {
    const { service } = setup()
    await expect(service.results(teacher('stranger'), 'ex-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('ведущий дисциплину по-прежнему видит ведомость', async () => {
    const { service } = setup()
    await expect(service.results(teacher('lecturer'), 'ex-1')).resolves.toBeDefined()
  })
})

describe('ExamsService.setResults — ведомость без противоречий (C-F08)', () => {
  function setupWithMax(maxScore: number | null) {
    const env = setup()
    env.prisma.exam.findUnique.mockResolvedValue({ ...examRow, maxScore })
    return env
  }

  it('балл больше максимума экзамена → VALIDATION_ERROR, ничего не сохраняется', async () => {
    const { service, prisma } = setupWithMax(100)
    const err = await service
      .setResults(
        teacher('examiner'),
        {
          examId: 'ex-1',
          entries: [{ studentId: 'st-1', admitted: true, status: 'PASSED', score: 150 }],
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'entries.0.score' })])
    expect(prisma.examResult.upsert).not.toHaveBeenCalled()
  })

  it('недопущенному нельзя поставить «сдал»', async () => {
    const { service, prisma } = setupWithMax(100)
    const err = await service
      .setResults(
        teacher('examiner'),
        {
          examId: 'ex-1',
          entries: [{ studentId: 'st-1', admitted: false, status: 'PASSED', score: null }],
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'entries.0.status' })])
    expect(prisma.examResult.upsert).not.toHaveBeenCalled()
  })

  it('недопущенный с «неявкой» сохраняется', async () => {
    const { service, prisma } = setupWithMax(100)
    await service.setResults(
      teacher('examiner'),
      {
        examId: 'ex-1',
        entries: [{ studentId: 'st-1', admitted: false, status: 'ABSENT', score: null }],
      },
      ctx,
    )
    expect(prisma.examResult.upsert).toHaveBeenCalled()
  })
})

describe('ExamsService.list — ближайшие экзамены, а не самые старые', () => {
  const DAY = 24 * 60 * 60 * 1000
  const dean: JwtPayload = {
    sub: 'dean-1',
    role: Role.DEAN,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: null,
  }
  const exam = (id: string, offsetDays: number) => ({
    id,
    date: new Date(Date.now() + offsetDays * DAY),
  })

  // Сторона «после сейчас» отсортирована по возрастанию даты, «до сейчас» — по убыванию;
  // мок отвечает на каждый запрос своей стороной, обрезанной по take.
  function setupList(upcoming: { id: string; date: Date }[], past: { id: string; date: Date }[]) {
    const findMany = jest.fn(async (args: { orderBy: { date: string }[]; take: number }) =>
      (args.orderBy[0]?.date === 'asc' ? upcoming : past).slice(0, args.take),
    )
    const service = new ExamsService(
      { exam: { findMany } } as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
    )
    return { service, findMany }
  }

  it('после сотен прошедших экзаменов текущая сессия всё равно в выдаче', async () => {
    // Год работы факультета: 300 прошедших экзаменов и 150 предстоящих.
    const past = Array.from({ length: 300 }, (_, i) => exam(`p${i}`, -(i + 1)))
    const upcoming = Array.from({ length: 150 }, (_, i) => exam(`u${i}`, i + 1))
    const { service } = setupList(upcoming, past)

    const rows = (await service.list(dean, {})) as unknown as { id: string; date: Date }[]

    expect(rows).toHaveLength(200)
    // Ближайшие в обе стороны на месте, самые старые — нет.
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['u0', 'p0']))
    expect(rows.map((r) => r.id)).not.toContain('p299')
    // Ответ — по возрастанию даты, как и раньше.
    const times = rows.map((r) => r.date.getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('меньше потолка — отдаёт всё по возрастанию даты', async () => {
    const { service } = setupList([exam('u0', 1), exam('u1', 3)], [exam('p0', -2)])
    const rows = (await service.list(dean, {})) as unknown as { id: string }[]
    expect(rows.map((r) => r.id)).toEqual(['p0', 'u0', 'u1'])
  })

  it('период from/to сужает выборку, scope остаётся первым условием', async () => {
    const { service, findMany } = setupList([], [])
    await service.list(dean, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    })
    const where = (findMany.mock.calls[0]?.[0] as unknown as { where: { AND: unknown[] } }).where
    expect(where.AND[0]).toEqual({ group: { is: { facultyId: 'fac-1' } } })
    expect(where.AND).toContainEqual({ date: { gte: new Date('2026-01-01T00:00:00.000Z') } })
    expect(where.AND).toContainEqual({ date: { lt: new Date('2026-02-01T00:00:00.000Z') } })
  })
})
