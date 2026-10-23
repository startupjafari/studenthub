import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { AssignmentsService, SUBMISSION_FILES_LIMIT } from './assignments.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { FileService } from '../files/file.service'
import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

const student: JwtPayload = {
  sub: 'stu-1',
  role: Role.STUDENT,
  universityId: 'uni-1',
  facultyId: 'fac-1',
  groupId: 'grp-1',
}
const teacher: JwtPayload = {
  sub: 't-1',
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

const course = {
  id: 'c-1',
  groupId: 'grp-1',
  teacherId: 't-1',
  subject: { id: 's-1', name: 'Физика' },
  group: { id: 'grp-1', name: 'ФИ-21' },
}

function setup(opts: { submission?: object | null } = {}) {
  const prisma = {
    assignment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'as-1',
        status: 'PUBLISHED',
        dueAt: null,
        allowLate: false,
        course,
      }),
      update: jest.fn().mockResolvedValue({ id: 'as-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    submission: {
      findUnique: jest.fn().mockResolvedValue(opts.submission ?? null),
      upsert: jest.fn().mockResolvedValue({ id: 'sub-new' }),
      update: jest.fn().mockResolvedValue({ id: 'sub-1', student: { id: 'stu-1' } }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'sub-new' }),
      aggregate: jest.fn().mockResolvedValue({ _max: { score: null } }),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'stu-1' }]) },
    file: {
      update: jest.fn().mockResolvedValue({ id: 'f-1', name: 'отчёт.pdf' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
    },
  }
  const files = {
    upload: jest.fn().mockResolvedValue({ id: 'f-1' }),
    presignPut: jest.fn().mockResolvedValue({ key: 'stu-1/k.pdf', url: 'u', expiresAt: 'e' }),
    confirmDirectUpload: jest.fn().mockResolvedValue({ id: 'f-2' }),
    delete: jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn().mockResolvedValue('https://minio/signed'),
  }
  const config = { get: jest.fn().mockReturnValue('applications') }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const service = new AssignmentsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    queue as unknown as QueueService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, files, audit, queue }
}

describe('AssignmentsService — файлы в сдаче (C-F06)', () => {
  it('работа из одних файлов отправляется', async () => {
    const { service, prisma } = setup({
      submission: {
        id: 'sub-1',
        status: 'DRAFT',
        text: null,
        linkUrl: null,
        attemptNumber: 1,
        _count: { files: 1 },
      },
    })
    await service.submit(student, 'as-1')
    expect(prisma.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    )
  })

  it('без текста, ссылки и файлов — «Работа пустая»', async () => {
    const { service, prisma } = setup({
      submission: {
        id: 'sub-1',
        status: 'DRAFT',
        text: null,
        linkUrl: null,
        attemptNumber: 1,
        _count: { files: 0 },
      },
    })
    await expect(service.submit(student, 'as-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    expect(prisma.submission.update).not.toHaveBeenCalled()
  })

  it('первый файл заводит черновик и привязывается к нему', async () => {
    const { service, prisma, files } = setup({ submission: null })
    await service.addSubmissionFile(student, 'as-1', {
      buffer: Buffer.from('x'),
      name: 'отчёт.pdf',
    })
    expect(files.upload).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'applications', ownerId: 'stu-1', name: 'отчёт.pdf' }),
    )
    expect(prisma.submission.upsert).toHaveBeenCalled()
    expect(prisma.file.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f-1' }, data: { submissionId: 'sub-new' } }),
    )
  })

  it('в отправленную работу файл не добавить — даже ссылку на запись не выдаём', async () => {
    const { service, files } = setup({
      submission: { id: 'sub-1', status: 'SUBMITTED', _count: { files: 0 } },
    })
    await expect(
      service.presignSubmissionFile(student, 'as-1', 'application/pdf'),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(files.presignPut).not.toHaveBeenCalled()
  })

  it(`больше ${SUBMISSION_FILES_LIMIT} файлов не принимается`, async () => {
    const { service, files } = setup({
      submission: { id: 'sub-1', status: 'DRAFT', _count: { files: SUBMISSION_FILES_LIMIT } },
    })
    await expect(
      service.confirmSubmissionFile(student, 'as-1', 'stu-1/k.pdf', 'k.pdf'),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(files.confirmDirectUpload).not.toHaveBeenCalled()
  })

  it('из отправленной работы файл не удаляется', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findFirst.mockResolvedValue({ id: 'f-1', submission: { status: 'SUBMITTED' } })
    await expect(service.removeSubmissionFile(student, 'as-1', 'f-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('чужую работу студент не скачает', async () => {
    const { service, prisma, files } = setup()
    prisma.submission.findUnique.mockResolvedValue({
      studentId: 'stu-2',
      assignment: { course },
    })
    await expect(service.getSubmissionFileUrl(student, 'sub-2', 'f-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('преподаватель дисциплины получает ссылку на скачивание', async () => {
    const { service, prisma, files } = setup()
    prisma.submission.findUnique.mockResolvedValue({
      studentId: 'stu-2',
      status: 'SUBMITTED',
      assignment: { course },
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f-1' })
    await expect(service.getSubmissionFileUrl(teacher, 'sub-2', 'f-1')).resolves.toMatchObject({
      url: 'https://minio/signed',
    })
    expect(files.getPresignedUrl).toHaveBeenCalledWith('f-1', undefined, true)
  })

  it('файл неотправленного черновика проверяющему не отдаётся', async () => {
    const { service, prisma, files } = setup()
    prisma.submission.findUnique.mockResolvedValue({
      studentId: 'stu-2',
      status: 'DRAFT',
      assignment: { course },
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f-1' })
    await expect(service.getSubmissionFileUrl(teacher, 'sub-2', 'f-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('модератор платформы файл сдачи не скачает — круг тот же, что у списка сдач', async () => {
    const { service, prisma, files } = setup()
    prisma.submission.findUnique.mockResolvedValue({
      studentId: 'stu-2',
      status: 'SUBMITTED',
      assignment: { course },
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f-1' })
    const moderator: JwtPayload = {
      sub: 'pm-1',
      role: Role.PLATFORM_MODERATOR,
      universityId: null,
      facultyId: null,
      groupId: null,
    }
    await expect(service.getSubmissionFileUrl(moderator, 'sub-2', 'f-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('список сдач проверяющего — без неотправленных черновиков', async () => {
    const { service, prisma } = setup()
    const findMany = jest.fn().mockResolvedValue([])
    Object.assign(prisma.submission, { findMany })
    await service.submissions(teacher, 'as-1')
    expect(findMany.mock.calls[0][0].where).toEqual({
      assignmentId: 'as-1',
      status: { not: 'DRAFT' },
    })
  })
})

describe('AssignmentsService.remove — сданные работы не стираются (C-F07)', () => {
  it('есть отправленные работы → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.assignment.deleteMany.mockResolvedValue({ count: 0 })
    await expect(service.remove(teacher, 'as-1', ctx)).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('условие «нет отправленных работ» — в самом удалении', async () => {
    const { service, prisma } = setup()
    await service.remove(teacher, 'as-1', ctx)
    expect(prisma.assignment.deleteMany).toHaveBeenCalledWith({
      where: { id: 'as-1', submissions: { none: { status: { not: 'DRAFT' } } } },
    })
  })
})

describe('AssignmentsService — балл не больше максимума (C-F08)', () => {
  function gradable(maxScore: number | null) {
    const env = setup()
    env.prisma.submission.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'SUBMITTED',
      assignment: { title: 'ЛР1', maxScore, course },
    })
    return env
  }

  it('«150 из 100» → VALIDATION_ERROR с полем score', async () => {
    const { service, prisma } = gradable(100)
    await expect(service.grade(teacher, 'sub-1', { score: 150 }, ctx)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field: 'score' })],
    })
    expect(prisma.submission.update).not.toHaveBeenCalled()
  })

  it('ровно максимум принимается', async () => {
    const { service, prisma } = gradable(100)
    await service.grade(teacher, 'sub-1', { score: 100 }, ctx)
    expect(prisma.submission.update).toHaveBeenCalled()
  })

  it('без максимума действует только общий потолок схемы', async () => {
    const { service, prisma } = gradable(null)
    await service.grade(teacher, 'sub-1', { score: 150 }, ctx)
    expect(prisma.submission.update).toHaveBeenCalled()
  })

  it('максимум не опускается ниже выставленного балла', async () => {
    const { service, prisma } = setup()
    prisma.submission.aggregate.mockResolvedValue({ _max: { score: 90 } })
    await expect(service.update(teacher, 'as-1', { maxScore: 50 }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.assignment.update).not.toHaveBeenCalled()
  })
})

// ── C-F17: список студента «актуальные сверху» ──────────────────────────────
describe('AssignmentsService.list — порядок для студента (C-F17)', () => {
  // Части списка различаем по условию: у «остальных» есть status: { not: 'PUBLISHED' }.
  const isRest = (where: unknown): boolean => JSON.stringify(where).includes('"not":"PUBLISHED"')

  function listSetup(openTotal: number, restTotal: number) {
    const { service, prisma } = setup()
    const count = jest.fn(({ where }: { where: unknown }) =>
      Promise.resolve(isRest(where) ? restTotal : openTotal),
    )
    const findMany = jest.fn(({ where, take }: { where: unknown; take: number }) =>
      Promise.resolve(
        Array.from({ length: take }, (_, i) => ({
          id: `${isRest(where) ? 'rest' : 'open'}-${i}`,
          submissions: [],
        })),
      ),
    )
    const $transaction = jest.fn((ops: Promise<unknown>[]) => Promise.all(ops))
    Object.assign(prisma.assignment, { count, findMany })
    Object.assign(prisma, { $transaction })
    return { service, count, findMany }
  }

  it('первая страница: открытые по ближайшему сроку, затем прошедшие от свежих', async () => {
    const { service, findMany } = listSetup(2, 5)
    const res = await service.list(student, { page: 1, limit: 3 })

    expect(res.items.map((r) => (r as { id: string }).id)).toEqual(['open-0', 'open-1', 'rest-0'])
    expect(res.meta).toEqual({ total: 7 })
    const [open = {}, rest = {}] = findMany.mock.calls.map((c) => c[0] as Record<string, unknown>)
    expect(open).toMatchObject({
      skip: 0,
      take: 2,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    })
    expect(rest).toMatchObject({
      skip: 0,
      take: 1,
      orderBy: [{ dueAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    })
    // Открытые — опубликованные со сроком впереди или без срока; scope студента сохранён.
    expect(JSON.stringify(open.where)).toContain('"status":"PUBLISHED"')
    expect(JSON.stringify(open.where)).toContain('"dueAt":null')
    expect(JSON.stringify(rest.where)).toContain('"groupId":"grp-1"')
  })

  it('страница за открытыми читает только прошедшие со сдвигом', async () => {
    const { service, findMany } = listSetup(2, 5)
    const res = await service.list(student, { page: 2, limit: 3 })

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 1, take: 3 })
    expect(res.items).toHaveLength(3)
  })

  it('явная сортировка и роль преподавателя — прежний порядок одним запросом', async () => {
    const { service, findMany } = listSetup(0, 0)
    await service.list(student, { page: 1, limit: 10, sort: 'dueAt', order: 'asc' })
    await service.list(teacher, { page: 1, limit: 10 })

    expect(findMany).toHaveBeenCalledTimes(2)
    for (const [args] of findMany.mock.calls) {
      expect(args).toMatchObject({ orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }] })
    }
  })

  it('dueFrom/dueTo сужают выборку по сроку: от включительно, до — не включая', async () => {
    const { service, count } = listSetup(0, 0)
    await service.list(student, {
      page: 1,
      limit: 10,
      dueFrom: '2026-10-01T00:00:00.000Z',
      dueTo: '2026-11-01T00:00:00.000Z',
    })

    const where = JSON.stringify((count.mock.calls[0]?.[0] as { where: unknown }).where)
    expect(where).toContain('"gte":"2026-10-01T00:00:00.000Z"')
    expect(where).toContain('"lt":"2026-11-01T00:00:00.000Z"')
  })
})

// ── C-F20: переходы статусов, правка опубликованного, переоценка ──────────────
describe('AssignmentsService — переходы статуса задания (C-F20)', () => {
  const stale = () =>
    new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '6' })

  function withStatus(status: string) {
    const env = setup()
    env.prisma.assignment.findUnique.mockResolvedValue({ id: 'as-1', status, course })
    env.prisma.assignment.update.mockResolvedValue({
      id: 'as-1',
      title: 'ЛР1',
      course: { ...course, group: { id: 'grp-1', name: 'ФИ-21' } },
    })
    return env
  }

  it.each([
    ['DRAFT', 'CLOSED'],
    ['PUBLISHED', 'PUBLISHED'],
    ['CLOSED', 'CLOSED'],
  ] as const)('%s → %s запрещён: CONFLICT, статус не меняется', async (from, to) => {
    const { service, prisma } = withStatus(from)
    await expect(service.setStatus(teacher, 'as-1', to, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.assignment.update).not.toHaveBeenCalled()
  })

  it('публикация черновика: условие на исходный статус, время публикации, рассылка', async () => {
    const { service, prisma, queue } = withStatus('DRAFT')
    await service.setStatus(teacher, 'as-1', 'PUBLISHED', ctx)
    expect(prisma.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'as-1', status: 'DRAFT' },
        data: expect.objectContaining({ status: 'PUBLISHED', publishAt: expect.any(Date) }),
      }),
    )
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
  })

  it('повторное открытие закрытого: без нового времени публикации и без рассылки', async () => {
    const { service, prisma, queue, audit } = withStatus('CLOSED')
    await service.setStatus(teacher, 'as-1', 'PUBLISHED', ctx)
    const arg = prisma.assignment.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'as-1', status: 'CLOSED' })
    expect(arg.data).toEqual({ status: 'PUBLISHED' })
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment_reopened' }),
    )
  })

  it('статус успели сменить параллельно (P2025) → CONFLICT, без рассылки', async () => {
    const { service, prisma, queue } = withStatus('DRAFT')
    prisma.assignment.update.mockRejectedValue(stale())
    await expect(service.setStatus(teacher, 'as-1', 'PUBLISHED', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('AssignmentsService.update — правка опубликованного задания (C-F20)', () => {
  function withAssignment(status: string) {
    const env = setup()
    env.prisma.assignment.findUnique.mockResolvedValue({
      id: 'as-1',
      status,
      title: 'ЛР1',
      description: null,
      type: 'LAB',
      submissionType: 'TEXT',
      maxScore: 10,
      maxAttempts: null,
      allowLate: false,
      dueAt: new Date('2026-10-20T18:00:00.000Z'),
      course,
    })
    env.prisma.assignment.update.mockResolvedValue({
      id: 'as-1',
      title: 'ЛР1',
      type: 'LAB',
      submissionType: 'TEXT',
      maxScore: 10,
      maxAttempts: null,
      allowLate: false,
      dueAt: new Date('2026-10-27T18:00:00.000Z'),
    })
    return env
  }

  it('продление срока опубликованного: правка проходит, аудит — «было → стало»', async () => {
    const { service, prisma, audit } = withAssignment('PUBLISHED')
    await service.update(teacher, 'as-1', { dueAt: '2026-10-27T18:00:00.000Z' }, ctx)
    expect(prisma.assignment.update).toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assignment_updated',
        metadata: expect.objectContaining({
          status: 'PUBLISHED',
          changes: {
            dueAt: { from: '2026-10-20T18:00:00.000Z', to: '2026-10-27T18:00:00.000Z' },
          },
        }),
      }),
    )
  })

  it('время публикации у опубликованного не меняется → CONFLICT', async () => {
    const { service, prisma } = withAssignment('PUBLISHED')
    const err = await service
      .update(teacher, 'as-1', { publishAt: '2026-10-25T09:00:00.000Z' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual([expect.objectContaining({ field: 'publishAt' })])
    expect(prisma.assignment.update).not.toHaveBeenCalled()
  })

  it('у черновика время публикации править можно', async () => {
    const { service, prisma } = withAssignment('DRAFT')
    await service.update(teacher, 'as-1', { publishAt: '2026-10-25T09:00:00.000Z' }, ctx)
    expect(prisma.assignment.update).toHaveBeenCalled()
  })
})

describe('AssignmentsService — оценка, переоценка и возврат (C-F20)', () => {
  const stale = () =>
    new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '6' })
  const gradedAt = new Date('2026-10-10T10:00:00.000Z')

  function withSubmission(status: string) {
    const env = setup()
    env.prisma.submission.findUnique.mockResolvedValue({
      id: 'sub-1',
      status,
      score: status === 'GRADED' ? 6 : null,
      gradedAt: status === 'GRADED' ? gradedAt : null,
      gradedById: status === 'GRADED' ? 't-1' : null,
      assignment: { title: 'ЛР1', maxScore: 10, course },
    })
    env.prisma.submission.update.mockResolvedValue({
      id: 'sub-1',
      attemptNumber: 1,
      student: { id: 'stu-1' },
    })
    return env
  }

  it('оценка сданной работы — условие на статус SUBMITTED', async () => {
    const { service, prisma } = withSubmission('SUBMITTED')
    await service.grade(teacher, 'sub-1', { score: 8 }, ctx)
    expect(prisma.submission.update.mock.calls[0][0].where).toEqual({
      id: 'sub-1',
      status: 'SUBMITTED',
    })
  })

  it('переоценка: прежний балл в аудите, условие на прежнюю оценку, новое уведомление', async () => {
    const { service, prisma, audit, queue } = withSubmission('GRADED')
    await service.grade(teacher, 'sub-1', { score: 9 }, ctx)
    expect(prisma.submission.update.mock.calls[0][0].where).toEqual({
      id: 'sub-1',
      status: 'GRADED',
      gradedAt,
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'submission_regraded',
        metadata: { previousScore: 6, score: 9, previousGradedById: 't-1' },
      }),
    )
    const job = queue.enqueue.mock.calls[0][2]
    expect(job.dedupeKey).toMatch(/^submission-regraded:sub-1:\d+$/)
  })

  it('«оценить» и «вернуть» одновременно: проигравший получает CONFLICT', async () => {
    const { service, prisma, queue } = withSubmission('SUBMITTED')
    prisma.submission.update.mockRejectedValue(stale())
    await expect(service.grade(teacher, 'sub-1', { score: 8 }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(
      service.returnForFix(teacher, 'sub-1', { feedback: 'Исправьте' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('вернуть можно только сданную: оценённую → CONFLICT', async () => {
    const { service, prisma } = withSubmission('GRADED')
    await expect(
      service.returnForFix(teacher, 'sub-1', { feedback: 'Исправьте' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.submission.update).not.toHaveBeenCalled()
  })

  it('черновик и возвращённую не оценить → CONFLICT', async () => {
    for (const status of ['DRAFT', 'RETURNED']) {
      const { service, prisma } = withSubmission(status)
      await expect(service.grade(teacher, 'sub-1', { score: 5 }, ctx)).rejects.toMatchObject({
        code: 'CONFLICT',
      })
      expect(prisma.submission.update).not.toHaveBeenCalled()
    }
  })
})

describe('AssignmentsService.saveDraft — не переписывает отправленную работу (C-F20)', () => {
  it('статус — в условии записи: правится только черновик или возвращённая', async () => {
    const { service, prisma } = setup()
    prisma.submission.findUnique.mockResolvedValue({ id: 'sub-1', status: 'DRAFT' })
    await service.saveDraft(student, 'as-1', { text: 'ответ' })
    expect(prisma.submission.updateMany).toHaveBeenCalledWith({
      where: { assignmentId: 'as-1', studentId: 'stu-1', status: { in: ['DRAFT', 'RETURNED'] } },
      data: { text: 'ответ', linkUrl: undefined },
    })
    expect(prisma.submission.create).not.toHaveBeenCalled()
  })

  it('работа уже отправлена (строка есть, черновика нет) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.submission.updateMany.mockResolvedValue({ count: 0 })
    prisma.submission.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6' }),
    )
    await expect(service.saveDraft(student, 'as-1', { text: 'ответ' })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('первое сохранение заводит черновик', async () => {
    const { service, prisma } = setup()
    prisma.submission.updateMany.mockResolvedValue({ count: 0 })
    prisma.submission.findUnique.mockResolvedValue({ id: 'sub-new', status: 'DRAFT' })
    const res = await service.saveDraft(student, 'as-1', { text: 'ответ' })
    expect(prisma.submission.create).toHaveBeenCalled()
    expect(res).toMatchObject({ id: 'sub-new' })
  })
})
