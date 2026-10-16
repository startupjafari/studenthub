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
      aggregate: jest.fn().mockResolvedValue({ _max: { score: null } }),
    },
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
  return { service, prisma, files }
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
      assignment: { course },
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f-1' })
    await expect(service.getSubmissionFileUrl(teacher, 'sub-2', 'f-1')).resolves.toMatchObject({
      url: 'https://minio/signed',
    })
    expect(files.getPresignedUrl).toHaveBeenCalledWith('f-1', undefined, true)
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
