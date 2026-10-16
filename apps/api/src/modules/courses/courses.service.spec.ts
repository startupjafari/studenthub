import { Role } from '@studenthub/shared-types'
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
