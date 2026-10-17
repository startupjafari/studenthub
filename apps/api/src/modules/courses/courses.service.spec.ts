import { Role } from '@studenthub/shared-types'
import { Prisma } from '@prisma/client'
import { CoursesService } from './courses.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const admin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(counts: { grades?: number; submissions?: number; results?: number } = {}) {
  const prisma = {
    course: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c-1', groupId: 'grp-1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    group: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ facultyId: 'fac-1', faculty: { universityId: 'uni-1' } }),
    },
    grade: { count: jest.fn().mockResolvedValue(counts.grades ?? 0) },
    submission: { count: jest.fn().mockResolvedValue(counts.submissions ?? 0) },
    examResult: { count: jest.fn().mockResolvedValue(counts.results ?? 0) },
    user: { findFirst: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
    $transaction: jest.fn(),
  }
  // Колбэк-транзакция: в tx — тот же мок, чтобы проверять вызовы как обычно.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : arg,
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new CoursesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma }
}

describe('CoursesService.deleteCourse — академические записи', () => {
  it.each([{ grades: 1 }, { submissions: 2 }, { results: 1 }])(
    'есть записи %o → CONFLICT, дисциплина остаётся',
    async (counts) => {
      const { service, prisma } = setup(counts)
      const err = await service.deleteCourse(admin, 'c-1', ctx).catch((e) => e)
      expect(err.code).toBe('CONFLICT')
      expect(prisma.course.delete).not.toHaveBeenCalled()
    },
  )

  it('пустая дисциплина удаляется — в той же транзакции, что и подсчёт', async () => {
    const { service, prisma } = setup()
    await service.deleteCourse(admin, 'c-1', ctx)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.course.delete).toHaveBeenCalledWith({ where: { id: 'c-1' } })
  })

  it('ведомость зачёта без баллов (сдал, неявка, недопуск) держит дисциплину', async () => {
    const { service, prisma } = setup({ results: 3 })
    const err = await service.deleteCourse(admin, 'c-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.course.delete).not.toHaveBeenCalled()
    // Считаются не только строки с баллом: статус, отличный от «назначен», и недопуск —
    // тоже записи ведомости.
    expect(prisma.examResult.count).toHaveBeenCalledWith({
      where: {
        exam: { courseId: 'c-1' },
        OR: [{ status: { not: 'SCHEDULED' } }, { score: { not: null } }, { admitted: false }],
      },
    })
  })

  it('дисциплину успели удалить параллельно — NOT_FOUND, без повторного delete', async () => {
    const { service, prisma } = setup()
    prisma.$queryRaw.mockResolvedValue([])
    const err = await service.deleteCourse(admin, 'c-1', ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.course.delete).not.toHaveBeenCalled()
  })
})

describe('CoursesService.updateCourse — кого можно назначить преподавателем', () => {
  it('студента своего вуза — BAD_REQUEST, дисциплина не меняется', async () => {
    const { service, prisma } = setup()
    ;(prisma as unknown as { course: { update: jest.Mock } }).course.update = jest.fn()
    prisma.user.findFirst.mockResolvedValue({ universityId: 'uni-1', role: Role.STUDENT })
    const err = await service
      .updateCourse(admin, 'c-1', { teacherId: 'stu-1' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('удалённого или заблокированного — его как бы нет', async () => {
    const { service, prisma } = setup()
    prisma.user.findFirst.mockResolvedValue(null)
    const err = await service.updateCourse(admin, 'c-1', { teacherId: 't-x' }, ctx).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't-x', deletedAt: null, isBlocked: false } }),
    )
  })
})

// ── C-F05: семестр — даты и единственный активный ───────────────────────────
describe('CoursesService — семестры (C-F05)', () => {
  function withTerms() {
    const env = setup()
    const term = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'tm-1',
        universityId: 'uni-1',
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
      }),
      create: jest.fn().mockResolvedValue({ id: 'tm-new' }),
      update: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    }
    const executeRaw = jest.fn().mockResolvedValue(0)
    Object.assign(env.prisma, { term, $executeRaw: executeRaw })
    return { ...env, term, executeRaw }
  }

  it('правка одной даты сверяется с сохранённой: конец раньше начала → VALIDATION_ERROR', async () => {
    const { service, term } = withTerms()
    const err = await service
      .updateTerm(admin, 'tm-1', { endsOn: '2026-08-01' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'endsOn' })])
    expect(term.update).not.toHaveBeenCalled()
  })

  it('начало позже сохранённого конца → VALIDATION_ERROR по startsOn', async () => {
    const { service, term } = withTerms()
    const err = await service
      .updateTerm(admin, 'tm-1', { startsOn: '2027-01-15' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'startsOn' })])
    expect(term.update).not.toHaveBeenCalled()
  })

  it('активация семестра снимает флаг с остальных семестров вуза — под локом, в транзакции', async () => {
    const { service, term, executeRaw } = withTerms()
    await service.updateTerm(admin, 'tm-1', { isActive: true }, ctx)
    expect(executeRaw).toHaveBeenCalled()
    expect(term.updateMany).toHaveBeenCalledWith({
      where: { universityId: 'uni-1', isActive: true, id: { not: 'tm-1' } },
      data: { isActive: false },
    })
    expect(term.update).toHaveBeenCalled()
  })

  it('правка без активации остальные семестры не трогает', async () => {
    const { service, term } = withTerms()
    await service.updateTerm(admin, 'tm-1', { name: 'Осень 2026' }, ctx)
    expect(term.updateMany).not.toHaveBeenCalled()
  })

  it('новый активный семестр гасит прежний', async () => {
    const { service, term } = withTerms()
    await service.createTerm(
      admin,
      {
        universityId: 'uni-1',
        name: 'Весна 2027',
        startsOn: '2027-02-01',
        endsOn: '2027-06-30',
        isActive: true,
      },
      ctx,
    )
    expect(term.updateMany).toHaveBeenCalledWith({
      where: { universityId: 'uni-1', isActive: true },
      data: { isActive: false },
    })
    expect(term.create).toHaveBeenCalled()
  })

  it('удаление предмета: CONFLICT только на внешнем ключе, остальные ошибки — как есть', async () => {
    const env = setup()
    const subject = {
      findUnique: jest.fn().mockResolvedValue({ id: 'sb-1', universityId: 'uni-1' }),
      delete: jest
        .fn()
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' }),
        )
        .mockRejectedValueOnce(new Error('connection lost')),
    }
    Object.assign(env.prisma, { subject })
    const fk = await env.service.deleteSubject(admin, 'sb-1', ctx).catch((e) => e)
    expect(fk.code).toBe('CONFLICT')
    const other = await env.service.deleteSubject(admin, 'sb-1', ctx).catch((e) => e)
    expect(other).toBeInstanceOf(Error)
    expect(other.message).toBe('connection lost')
  })
})

// ── C-F04: дисциплина без семестра — одна на группу ─────────────────────────
describe('CoursesService — дубли дисциплины без семестра (C-F04)', () => {
  function withCourses(twin: { id: string } | null) {
    const env = setup()
    Object.assign(env.prisma.course, {
      findFirst: jest.fn().mockResolvedValue(twin),
      create: jest.fn().mockResolvedValue({ id: 'c-new' }),
      update: jest.fn().mockResolvedValue({ id: 'c-1' }),
    })
    const subject = { findUnique: jest.fn().mockResolvedValue({ universityId: 'uni-1' }) }
    const executeRaw = jest.fn().mockResolvedValue(0)
    Object.assign(env.prisma, { subject, $executeRaw: executeRaw })
    const course = env.prisma.course as typeof env.prisma.course & {
      findFirst: jest.Mock
      create: jest.Mock
      update: jest.Mock
    }
    return { ...env, course, executeRaw }
  }

  it('вторая такая же дисциплина без семестра → CONFLICT, не создаётся', async () => {
    const { service, course, executeRaw } = withCourses({ id: 'c-old' })
    const err = await service
      .createCourse(admin, { subjectId: 'sb-1', groupId: 'grp-1' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(executeRaw).toHaveBeenCalled()
    expect(course.findFirst).toHaveBeenCalledWith({
      where: { subjectId: 'sb-1', groupId: 'grp-1', termId: null },
      select: { id: true },
    })
    expect(course.create).not.toHaveBeenCalled()
  })

  it('первая дисциплина без семестра создаётся', async () => {
    const { service, course } = withCourses(null)
    await service.createCourse(admin, { subjectId: 'sb-1', groupId: 'grp-1' }, ctx)
    expect(course.create).toHaveBeenCalled()
  })

  it('с семестром — без проверки и лока: дубль держит уникальный индекс', async () => {
    const { service, prisma, course, executeRaw } = withCourses(null)
    Object.assign(prisma, {
      term: { findUnique: jest.fn().mockResolvedValue({ universityId: 'uni-1' }) },
    })
    await service.createCourse(admin, { subjectId: 'sb-1', groupId: 'grp-1', termId: 'tm-1' }, ctx)
    expect(course.findFirst).not.toHaveBeenCalled()
    expect(executeRaw).not.toHaveBeenCalled()
    expect(course.create).toHaveBeenCalled()
  })

  it('снять семестр, когда у группы уже есть такая без семестра → CONFLICT', async () => {
    const { service, course } = withCourses({ id: 'c-old' })
    course.findUnique.mockResolvedValue({
      id: 'c-1',
      groupId: 'grp-1',
      subjectId: 'sb-1',
      termId: 'tm-1',
    })
    const err = await service.updateCourse(admin, 'c-1', { termId: null }, ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(course.findFirst).toHaveBeenCalledWith({
      where: { subjectId: 'sb-1', groupId: 'grp-1', termId: null, id: { not: 'c-1' } },
      select: { id: true },
    })
    expect(course.update).not.toHaveBeenCalled()
  })

  it('удаление семестра, после которого появились бы дубли без семестра → CONFLICT', async () => {
    const env = setup()
    const term = {
      findUnique: jest.fn().mockResolvedValue({ id: 'tm-1', universityId: 'uni-1' }),
      delete: jest.fn(),
    }
    Object.assign(env.prisma, { term })
    env.prisma.$queryRaw.mockResolvedValue([{ id: 'c-1' }])
    const err = await env.service.deleteTerm(admin, 'tm-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(term.delete).not.toHaveBeenCalled()
  })
})
