import { Role } from '@studenthub/shared-types'
import { ExamsService, examConflicts, planExamResults } from './exams.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

// Экзамен по дисциплине преподавателя `lecturer`, принимает его `examiner`.
const examRow = {
  id: 'ex-1',
  groupId: 'grp-1',
  date: new Date('2026-06-10T04:00:00.000Z'),
  roomId: null,
  examinerId: 'examiner',
  course: {
    teacherId: 'lecturer',
    subject: { name: 'Матанализ' },
    group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
  },
}

function setup() {
  const prisma = {
    exam: {
      findUnique: jest.fn().mockResolvedValue(examRow),
      update: jest.fn().mockResolvedValue({ id: 'ex-1' }),
      delete: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]) },
    examResult: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ faculty: { university: { timezone: 'Asia/Almaty' } } }),
    },
    course: { findUnique: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
  )
  return { service, prisma, audit, queue }
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
      { enqueue: jest.fn() } as unknown as QueueService,
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

// ── C-F22: пересечения, уведомления, scope чтения ─────────────────────────────
describe('examConflicts', () => {
  const at = new Date('2026-06-10T04:00:00.000Z')
  const later = (min: number) => new Date(at.getTime() + min * 60_000)
  const slot = { groupId: 'g-1', date: at, roomId: 'r-1', examinerId: 'e-1' }

  it('группа не сдаёт два экзамена разом', () => {
    expect(
      examConflicts(slot, [{ date: later(30), groupId: 'g-1', roomId: null, examinerId: null }]),
    ).toEqual([expect.objectContaining({ field: 'date' })])
  })

  it('совместная сдача потока — та же аудитория и экзаменатор в то же время — не конфликт', () => {
    expect(
      examConflicts(slot, [{ date: at, groupId: 'g-2', roomId: 'r-1', examinerId: 'e-1' }]),
    ).toEqual([])
  })

  it('аудитория занята экзаменом, начавшимся в другое время', () => {
    expect(
      examConflicts(slot, [{ date: later(45), groupId: 'g-2', roomId: 'r-1', examinerId: 'e-2' }]),
    ).toEqual([expect.objectContaining({ field: 'roomId' })])
  })

  it('экзаменатор в то же время в другой аудитории', () => {
    expect(
      examConflicts(slot, [{ date: at, groupId: 'g-2', roomId: 'r-2', examinerId: 'e-1' }]),
    ).toEqual([expect.objectContaining({ field: 'examinerId' })])
  })
})

describe('ExamsService.create / update — пересечения и уведомления (C-F22)', () => {
  const dean: JwtPayload = {
    sub: 'dean-1',
    role: Role.DEAN,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: null,
  }
  const future = new Date(Date.now() + 7 * 24 * 60 * 60_000)

  function setupCreate() {
    const env = setup()
    env.prisma.course.findUnique.mockResolvedValue({
      groupId: 'grp-1',
      teacherId: 'lecturer',
      group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
    })
    env.prisma.exam.create.mockResolvedValue({
      id: 'ex-new',
      groupId: 'grp-1',
      date: future,
      course: { subject: { name: 'Матанализ' } },
    })
    return env
  }

  it('у группы в это время другой экзамен → CONFLICT, экзамен не создаётся', async () => {
    const { service, prisma } = setupCreate()
    prisma.exam.findMany.mockResolvedValue([
      { id: 'ex-2', date: future, groupId: 'grp-1', roomId: null, examinerId: 'other' },
    ])
    const err = await service
      .create(dean, { courseId: 'c-1', date: future.toISOString(), format: 'WRITTEN' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.exam.create).not.toHaveBeenCalled()
    // Кандидаты — в окне часа вокруг начала, по группе и экзаменатору.
    const where = prisma.exam.findMany.mock.calls[0][0].where
    expect(where.date).toEqual({
      gt: new Date(future.getTime() - 60 * 60_000),
      lt: new Date(future.getTime() + 60 * 60_000),
    })
    expect(where.OR).toEqual([{ groupId: 'grp-1' }, { examinerId: 'lecturer' }])
  })

  it('назначение предстоящего экзамена → уведомление группе через очередь', async () => {
    const { service, queue } = setupCreate()
    await service.create(
      dean,
      { courseId: 'c-1', date: future.toISOString(), format: 'WRITTEN' },
      ctx,
    )
    const [queueName, jobName, payload, opts] = queue.enqueue.mock.calls[0]
    expect(queueName).toBe('notifications')
    expect(jobName).toBe('exam-scheduled')
    expect(payload).toMatchObject({
      recipientIds: ['st-1'],
      type: 'SCHEDULE_CHANGE',
      titleKey: 'exams.scheduled.title',
      bodyKey: 'exams.course.body',
      params: { subject: 'Матанализ' },
      dedupeKey: 'exam-scheduled:ex-new',
    })
    expect(opts).toEqual({ jobId: 'exam-scheduled:ex-new' })
  })

  it('экзамен, заведённый задним числом, студентов не тревожит', async () => {
    const { service, prisma, queue } = setupCreate()
    const past = new Date(Date.now() - 24 * 60 * 60_000)
    prisma.exam.create.mockResolvedValue({
      id: 'ex-old',
      groupId: 'grp-1',
      date: past,
      course: { subject: { name: 'Матанализ' } },
    })
    await service.create(
      dean,
      { courseId: 'c-1', date: past.toISOString(), format: 'WRITTEN' },
      ctx,
    )
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('перенос даты → проверка пересечений и уведомление с новой датой в ключе', async () => {
    const { service, prisma, queue } = setup()
    prisma.exam.update.mockResolvedValue({
      id: 'ex-1',
      groupId: 'grp-1',
      date: future,
      course: { subject: { name: 'Матанализ' } },
    })
    await service.update(dean, 'ex-1', { date: future.toISOString() }, ctx)
    expect(prisma.exam.findMany).toHaveBeenCalled()
    expect(prisma.exam.findMany.mock.calls[0][0].where.id).toEqual({ not: 'ex-1' })
    expect(queue.enqueue.mock.calls[0][1]).toBe('exam-updated')
    expect(queue.enqueue.mock.calls[0][2].dedupeKey).toBe(
      `exam-updated:ex-1:${future.toISOString()}:-`,
    )
  })

  it('правка заметки — без проверки пересечений и без уведомления', async () => {
    const { service, prisma, queue } = setup()
    await service.update(dean, 'ex-1', { note: 'Взять зачётку' }, ctx)
    expect(prisma.exam.findMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('ExamsService.getById — преподаватель видит только свои экзамены (C-F22)', () => {
  function setupRead() {
    const env = setup()
    env.prisma.exam.findUnique.mockResolvedValue({
      id: 'ex-1',
      groupId: 'grp-1',
      course: { teacherId: 'lecturer' },
      examiner: { id: 'examiner' },
    })
    return env
  }

  it('посторонний преподаватель того же вуза → FORBIDDEN', async () => {
    const { service } = setupRead()
    await expect(service.getById(teacher('stranger'), 'ex-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('экзаменатор и ведущий дисциплину читают экзамен', async () => {
    const { service } = setupRead()
    await expect(service.getById(teacher('examiner'), 'ex-1')).resolves.toMatchObject({
      id: 'ex-1',
    })
    await expect(service.getById(teacher('lecturer'), 'ex-1')).resolves.toMatchObject({
      id: 'ex-1',
    })
  })
})

describe('ExamsService — экзамены прежней группы после перевода', () => {
  const movedStudent: JwtPayload = {
    sub: 'st-1',
    role: Role.STUDENT,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: 'grp-2',
  }

  it('список студента: текущая группа или экзамены с его результатом', async () => {
    const { service, prisma } = setup()
    await service.list(movedStudent, {})
    const where = prisma.exam.findMany.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({
      OR: [{ groupId: 'grp-2' }, { results: { some: { studentId: 'st-1' } } }],
    })
  })

  it('экзамен прежней группы со своим результатом открывается, без результата — нет', async () => {
    const { service, prisma } = setup()
    const row = {
      id: 'ex-1',
      groupId: 'grp-1',
      course: { teacherId: 'lecturer' },
      examiner: { id: 'examiner' },
    }
    prisma.exam.findUnique.mockResolvedValue({ ...row, results: [{ id: 'r-1', status: 'PASSED' }] })
    await expect(service.getById(movedStudent, 'ex-1')).resolves.toMatchObject({
      id: 'ex-1',
      myResult: { status: 'PASSED' },
    })
    prisma.exam.findUnique.mockResolvedValue({ ...row, results: [] })
    await expect(service.getById(movedStudent, 'ex-1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })
})

// ── C-F10: пересдача не затирает попытку бесследно ───────────────────────────
describe('planExamResults', () => {
  it('итог после «Пересдачи» — следующая попытка; прежнее значение — в changes', () => {
    const plan = planExamResults(
      [{ studentId: 's-1', admitted: true, status: 'RETAKE', score: 20, attempt: 1 }],
      [{ studentId: 's-1', admitted: true, status: 'PASSED', score: 75 }],
    )
    expect(plan.writes).toEqual([
      expect.objectContaining({ studentId: 's-1', status: 'PASSED', score: 75, attempt: 2 }),
    ])
    expect(plan.changes).toEqual([
      {
        studentId: 's-1',
        from: { admitted: true, status: 'RETAKE', score: 20, attempt: 1 },
        to: { admitted: true, status: 'PASSED', score: 75, attempt: 2 },
      },
    ])
  })

  it('исправление итога без «Пересдачи» — та же попытка', () => {
    const plan = planExamResults(
      [{ studentId: 's-1', admitted: true, status: 'FAILED', score: 40, attempt: 1 }],
      [{ studentId: 's-1', admitted: true, status: 'PASSED', score: 60 }],
    )
    expect(plan.writes[0]?.attempt).toBe(1)
  })

  it('строка без изменений не пишется; новая строка — первая попытка', () => {
    const plan = planExamResults(
      [{ studentId: 's-1', admitted: true, status: 'PASSED', score: 80, attempt: 1 }],
      [
        { studentId: 's-1', admitted: true, status: 'PASSED', score: 80 },
        { studentId: 's-2', admitted: true, status: 'SCHEDULED', score: null },
      ],
    )
    expect(plan.writes.map((w) => [w.studentId, w.attempt])).toEqual([['s-2', 1]])
    expect(plan.changes.map((c) => c.studentId)).toEqual(['s-2'])
  })
})

describe('ExamsService.setResults — аудит и уведомление о результате (C-F10, C-F22)', () => {
  it('аудит со значениями; уведомление — только тем, чей итог изменился', async () => {
    const { service, prisma, audit, queue } = setup()
    prisma.user.findMany.mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }])
    prisma.examResult.findMany.mockResolvedValueOnce([
      { studentId: 'st-1', admitted: true, status: 'RETAKE', score: null, attempt: 1 },
      { studentId: 'st-2', admitted: true, status: 'PASSED', score: 90, attempt: 1 },
    ])
    await service.setResults(
      teacher('examiner'),
      {
        examId: 'ex-1',
        entries: [
          { studentId: 'st-1', admitted: true, status: 'PASSED', score: 70 },
          { studentId: 'st-2', admitted: true, status: 'PASSED', score: 90 },
        ],
      },
      ctx,
    )
    // Строка st-2 не менялась — не переписывается.
    expect(prisma.examResult.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.examResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ attempt: 2 }) }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'exam_results_set',
        metadata: {
          count: 2,
          changes: [
            {
              studentId: 'st-1',
              from: { admitted: true, status: 'RETAKE', score: null, attempt: 1 },
              to: { admitted: true, status: 'PASSED', score: 70, attempt: 2 },
            },
          ],
        },
      }),
    )
    const [, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('exam-result')
    expect(payload).toMatchObject({
      recipientIds: ['st-1'],
      type: 'SYSTEM',
      titleKey: 'exams.result.title',
      params: { subject: 'Матанализ', date: '2026-06-10 09:00' },
    })
  })
})
