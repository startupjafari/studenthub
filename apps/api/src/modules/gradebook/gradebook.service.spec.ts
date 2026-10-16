import { Role } from '@studenthub/shared-types'
import { GradebookService } from './gradebook.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { RealtimeGateway } from '../../common/realtime'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const teacher: JwtPayload = {
  sub: 't-1',
  role: Role.TEACHER,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup(published: boolean, graded: number) {
  const prisma = {
    gradeColumn: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'col-1',
        published,
        course: {
          id: 'c-1',
          groupId: 'grp-1',
          teacherId: 't-1',
          group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
        },
      }),
      delete: jest.fn().mockResolvedValue({}),
    },
    grade: { count: jest.fn().mockResolvedValue(graded) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new GradebookService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {} as RealtimeGateway,
  )
  return { service, prisma }
}

describe('GradebookService.deleteColumn', () => {
  it('опубликованная колонка с оценками → CONFLICT, оценки остаются', async () => {
    const { service, prisma } = setup(true, 3)
    const err = await service.deleteColumn(teacher, 'col-1', ctx).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.gradeColumn.delete).not.toHaveBeenCalled()
  })

  it('черновая колонка удаляется даже с оценками', async () => {
    const { service, prisma } = setup(false, 3)
    await service.deleteColumn(teacher, 'col-1', ctx)
    expect(prisma.gradeColumn.delete).toHaveBeenCalled()
  })
})

describe('GradebookService — балл не больше максимума колонки (C-F08)', () => {
  function setupScores(maxScore: number | null, maxGiven: number | null = null) {
    const prisma = {
      gradeColumn: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'col-1',
          published: false,
          maxScore,
          course: {
            id: 'c-1',
            groupId: 'grp-1',
            teacherId: 't-1',
            group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
          },
        }),
        update: jest.fn().mockResolvedValue({ id: 'col-1' }),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }]) },
      grade: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _max: { score: maxGiven } }),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const service = new GradebookService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      {} as RealtimeGateway,
    )
    return { service, prisma }
  }

  it('«150 из 10» → VALIDATION_ERROR с адресом ячейки, ничего не сохраняется', async () => {
    const { service, prisma } = setupScores(10)
    const err = await service
      .saveGrades(
        teacher,
        {
          columnId: 'col-1',
          entries: [
            { studentId: 'st-1', score: 9 },
            { studentId: 'st-2', score: 150 },
          ],
        },
        ctx,
      )
      .catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual([expect.objectContaining({ field: 'entries.1.score' })])
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('в пределах максимума и очистка ячейки сохраняются', async () => {
    const { service, prisma } = setupScores(10)
    await service.saveGrades(
      teacher,
      {
        columnId: 'col-1',
        entries: [
          { studentId: 'st-1', score: 10 },
          { studentId: 'st-2', score: null },
        ],
      },
      ctx,
    )
    expect(prisma.grade.upsert).toHaveBeenCalled()
    expect(prisma.grade.deleteMany).toHaveBeenCalled()
  })

  it('максимум колонки не опускается ниже выставленной оценки', async () => {
    const { service, prisma } = setupScores(100, 90)
    await expect(
      service.updateColumn(teacher, 'col-1', { maxScore: 50 }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.gradeColumn.update).not.toHaveBeenCalled()
  })
})
