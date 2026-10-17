import { Role } from '@studenthub/shared-types'
import { GradebookService, diffGrades } from './gradebook.service'
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
    // У st-2 была оценка — пустая ячейка её снимает.
    prisma.grade.findMany.mockResolvedValueOnce([{ studentId: 'st-2', score: 5 }])
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

// ── C-F21: пишутся только изменённые ячейки, аудит со значениями, правка видна вживую ──
describe('diffGrades', () => {
  it('без изменений — пусто; новая, исправленная и снятая оценки — с прежним значением', () => {
    const before = [
      { studentId: 'a', score: 5 },
      { studentId: 'b', score: 7 },
      { studentId: 'c', score: 3 },
    ]
    expect(
      diffGrades(before, [
        { studentId: 'a', score: 5 },
        { studentId: 'b', score: 9 },
        { studentId: 'c', score: null },
        { studentId: 'd', score: 4 },
        { studentId: 'e', score: null },
      ]),
    ).toEqual([
      { studentId: 'b', from: 7, to: 9 },
      { studentId: 'c', from: 3, to: null },
      { studentId: 'd', from: null, to: 4 },
    ])
  })
})

describe('GradebookService.saveGrades / setPublished — правки опубликованных оценок (C-F21)', () => {
  function setupSave(published: boolean, before: { studentId: string; score: number | null }[]) {
    const prisma = {
      gradeColumn: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'col-1',
          published,
          maxScore: 10,
          course: {
            id: 'c-1',
            groupId: 'grp-1',
            teacherId: 't-1',
            group: { facultyId: 'fac-1', faculty: { universityId: 'uni-1' } },
          },
        }),
        update: jest.fn().mockResolvedValue({ id: 'col-1' }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }, { id: 'st-2' }, { id: 'st-3' }]),
      },
      grade: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValueOnce(before).mockResolvedValue([]),
      },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { emitEventToUser: jest.fn() }
    const service = new GradebookService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      realtime as unknown as RealtimeGateway,
    )
    return { service, prisma, audit, realtime }
  }

  const entries = [
    { studentId: 'st-1', score: 8 },
    { studentId: 'st-2', score: 6 },
    { studentId: 'st-3', score: null },
  ]

  it('ячейки с прежним значением не пишутся — чужая правка после загрузки страницы не затирается', async () => {
    // st-1 и st-3 пришли без изменений, st-2 исправлен 4 → 6.
    const { service, prisma } = setupSave(false, [
      { studentId: 'st-1', score: 8 },
      { studentId: 'st-2', score: 4 },
    ])
    await service.saveGrades(teacher, { columnId: 'col-1', entries }, ctx)
    expect(prisma.grade.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.grade.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { score: 6 } }),
    )
    expect(prisma.grade.deleteMany).not.toHaveBeenCalled()
  })

  it('аудит хранит прежнее и новое значение каждой изменённой ячейки', async () => {
    const { service, audit } = setupSave(true, [
      { studentId: 'st-1', score: 8 },
      { studentId: 'st-2', score: 4 },
      { studentId: 'st-3', score: 9 },
    ])
    await service.saveGrades(teacher, { columnId: 'col-1', entries }, ctx)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'grades_saved',
        metadata: {
          count: 3,
          published: true,
          changes: [
            { studentId: 'st-2', from: 4, to: 6 },
            { studentId: 'st-3', from: 9, to: null },
          ],
        },
      }),
    )
  })

  it('правка опубликованной колонки → событие только студентам с изменённой оценкой', async () => {
    const { service, realtime } = setupSave(true, [
      { studentId: 'st-1', score: 8 },
      { studentId: 'st-2', score: 4 },
    ])
    await service.saveGrades(teacher, { columnId: 'col-1', entries }, ctx)
    expect(realtime.emitEventToUser.mock.calls.map((c) => c[0])).toEqual(['st-2'])
    expect(realtime.emitEventToUser).toHaveBeenCalledWith('st-2', 'grade.published', 'col-1', {
      columnId: 'col-1',
    })
  })

  it('черновая колонка студенту не видна — событий нет', async () => {
    const { service, realtime } = setupSave(false, [])
    await service.saveGrades(teacher, { columnId: 'col-1', entries }, ctx)
    expect(realtime.emitEventToUser).not.toHaveBeenCalled()
  })

  it('снятие с публикации тоже обновляет экран студентов с оценкой', async () => {
    const { service, prisma, realtime } = setupSave(true, [])
    prisma.grade.findMany.mockReset().mockResolvedValue([{ studentId: 'st-1' }])
    await service.setPublished(teacher, 'col-1', false, ctx)
    expect(realtime.emitEventToUser).toHaveBeenCalledWith('st-1', 'grade.published', 'col-1', {
      columnId: 'col-1',
    })
  })
})

describe('GradebookService.myGrades — прошлые группы не пропадают (C-F21)', () => {
  it('дисциплины текущей группы и те, где есть моя опубликованная оценка', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    const service = new GradebookService(
      { course: { findMany } } as unknown as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      {} as RealtimeGateway,
    )
    await service.myGrades({
      sub: 'stu-1',
      role: Role.STUDENT,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-new',
    })
    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { groupId: 'grp-new' },
        {
          gradeColumns: { some: { published: true, grades: { some: { studentId: 'stu-1' } } } },
        },
      ],
    })
  })
})
