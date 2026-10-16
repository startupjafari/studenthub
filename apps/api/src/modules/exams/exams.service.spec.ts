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
