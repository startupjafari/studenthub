import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { GroupService } from './groups.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { UniversityService } from '../universities/universities.service'
import type { UserService } from '../users/users.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    group: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    faculty: { findUnique: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    schedule: { count: jest.fn().mockResolvedValue(0) },
    course: { count: jest.fn().mockResolvedValue(0) },
    exam: { count: jest.fn().mockResolvedValue(0) },
    material: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'grp-1' }]),
    $transaction: jest.fn(),
  }
  // Колбэк-транзакция: в tx — тот же мок, чтобы проверять вызовы как обычно.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : arg,
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }
  const users = {
    syncGroupStarosta: jest.fn().mockResolvedValue([]),
    afterStarostaChange: jest.fn().mockResolvedValue(undefined),
  }
  const service = new GroupService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
    users as unknown as UserService,
  )
  return { service, prisma, audit, universities, users }
}

function viewer(role: Role, scope: Partial<JwtPayload> = {}): JwtPayload {
  return {
    sub: 'u',
    role,
    universityId: scope.universityId ?? null,
    facultyId: scope.facultyId ?? null,
    groupId: scope.groupId ?? null,
  }
}

// Форма из GROUP_SELECT (faculty.universityId вложен).
const GROUP = {
  id: 'grp-1',
  name: 'ИТ-23-1',
  year: 2023,
  facultyId: 'fac-1',
  starostaId: null,
  createdAt: new Date(),
  faculty: { universityId: 'uni-1' },
}

describe('GroupService — create scope', () => {
  it('UNIVERSITY_ADMIN своего вуза — создаёт', async () => {
    const { service, prisma, universities } = setup()
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-1', universityId: 'uni-1' })
    prisma.group.create.mockResolvedValue(GROUP)
    const res = await service.create(
      viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }),
      { name: 'ИТ-23-1', facultyId: 'fac-1' },
      ctx,
    )
    expect(res.universityId).toBe('uni-1')
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
  })

  it('чужой вуз → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-1', universityId: 'uni-1' })
    await expect(
      service.create(
        viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-2' }),
        { name: 'X', facultyId: 'fac-1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('факультет не найден → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue(null)
    await expect(
      service.create(viewer(Role.PLATFORM_ADMIN), { name: 'X', facultyId: 'nope' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('GroupService — read scope', () => {
  it('студент видит свою группу, чужую — нет', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.getById(viewer(Role.STUDENT, { groupId: 'grp-1' }), 'grp-1'),
    ).resolves.toMatchObject({ id: 'grp-1' })
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.getById(viewer(Role.STUDENT, { groupId: 'grp-9' }), 'grp-1'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('декан своего факультета — ок', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.getById(viewer(Role.DEAN, { facultyId: 'fac-1' }), 'grp-1'),
    ).resolves.toMatchObject({ id: 'grp-1' })
  })

  it('декан чужого факультета → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.getById(viewer(Role.DEAN, { facultyId: 'fac-9' }), 'grp-1'),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('update: админ чужого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.update(
        viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-2' }),
        'grp-1',
        { name: 'X' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })

  it('list: декан фильтруется своим факультетом, студент — своей группой', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockResolvedValue([[], 0])
    await service.list(viewer(Role.DEAN, { facultyId: 'fac-7' }), 1, 20)
    expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({ facultyId: 'fac-7' })

    await service.list(viewer(Role.STUDENT, { groupId: 'grp-3' }), 1, 20)
    expect(prisma.group.findMany.mock.calls[1][0].where).toEqual({ id: 'grp-3' })
  })
})

describe('GroupService — assignStarosta', () => {
  it('участник группы → назначается', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({
      id: 'stud-1',
      groupId: 'grp-1',
      role: Role.STUDENT,
      isBlocked: false,
    })
    prisma.group.update.mockResolvedValue({ ...GROUP, starostaId: 'stud-1' })
    const res = await service.assignStarosta(
      viewer(Role.DEAN, { facultyId: 'fac-1' }),
      'grp-1',
      { starostaId: 'stud-1' },
      ctx,
    )
    expect(res.starostaId).toBe('stud-1')
  })

  it('не участник группы → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({
      id: 'x',
      groupId: 'grp-9',
      role: Role.STUDENT,
      isBlocked: false,
    })
    await expect(
      service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('пользователь уже староста другой группы (P2002) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({
      id: 'stud-1',
      groupId: 'grp-1',
      role: Role.STUDENT,
      isBlocked: false,
    })
    prisma.group.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('u', { code: 'P2002', clientVersion: '6' }),
    )
    await expect(
      service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: 'stud-1' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('снятие (null) — без проверки участника', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, starostaId: 'stud-1' })
    prisma.group.update.mockResolvedValue({ ...GROUP, starostaId: null })
    const res = await service.assignStarosta(
      viewer(Role.PLATFORM_ADMIN),
      'grp-1',
      { starostaId: null },
      ctx,
    )
    expect(res.starostaId).toBeNull()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })
})

describe('GroupService — assignStarosta: роль, а не только отметка', () => {
  const student = { id: 'stud-1', groupId: 'grp-1', role: Role.STUDENT, isBlocked: false }

  it('назначение меняет роли в той же транзакции и гасит сессии разжалованному', async () => {
    const { service, prisma, users } = setup()
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, starostaId: 'old-1' })
    prisma.user.findFirst.mockResolvedValue(student)
    prisma.group.update.mockResolvedValue({ ...GROUP, starostaId: 'stud-1' })
    users.syncGroupStarosta.mockResolvedValue(['old-1'])

    await service.assignStarosta(
      viewer(Role.DEAN, { facultyId: 'fac-1' }),
      'grp-1',
      { starostaId: 'stud-1' },
      ctx,
    )

    expect(users.syncGroupStarosta).toHaveBeenCalledWith(prisma, 'grp-1', 'stud-1')
    expect(users.afterStarostaChange).toHaveBeenCalledWith('u', 'grp-1', 'stud-1', ['old-1'])
  })

  it('снятие старосты возвращает роль студента всем старостам группы', async () => {
    const { service, prisma, users } = setup()
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, starostaId: 'stud-1' })
    prisma.group.update.mockResolvedValue({ ...GROUP, starostaId: null })

    await service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: null }, ctx)

    expect(users.syncGroupStarosta).toHaveBeenCalledWith(prisma, 'grp-1', null)
  })

  it('преподаватель с тем же groupId старостой не становится', async () => {
    const { service, prisma, users } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({ ...student, role: Role.TEACHER })

    await expect(
      service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: 'stud-1' }, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(users.syncGroupStarosta).not.toHaveBeenCalled()
  })

  it('заблокированного старостой не назначить', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({ ...student, isBlocked: true })

    await expect(
      service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: 'stud-1' }, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('GroupService — remove', () => {
  it('пустая группа удаляется под блокировкой строки, в одной транзакции с подсчётом', async () => {
    const { service, prisma, universities, audit } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.group.delete.mockResolvedValue(GROUP)
    await service.remove(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-1' }), 'grp-1', ctx)
    const lockSql = (prisma.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?')
    expect(lockSql).toContain('FOR UPDATE')
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.course.count.mock.invocationCallOrder[0] ?? 0,
    )
    expect(prisma.group.delete).toHaveBeenCalledWith({ where: { id: 'grp-1' } })
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'group_deleted' }))
  })

  // Студентов перевели, а курсы с оценками, экзамены и материалы остались: раньше всё это
  // уходило каскадом вместе с группой.
  it('курсы, экзамены, материалы без студентов → CONFLICT с перечнем, ничего не удалено', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.course.count.mockResolvedValue(3)
    prisma.exam.count.mockResolvedValue(2)
    prisma.material.count.mockResolvedValue(5)
    const err = await service
      .remove(viewer(Role.PLATFORM_ADMIN), 'grp-1', ctx)
      .catch((e: unknown) => e)
    expect(err).toMatchObject({
      code: 'CONFLICT',
      details: [
        { field: 'courses', message: 'курсы (3)' },
        { field: 'exams', message: 'экзамены (2)' },
        { field: 'materials', message: 'материалы (5)' },
      ],
    })
    expect((err as Error).message).toBe(
      'Нельзя удалить группу, пока в ней есть: курсы (3), экзамены (2), материалы (5)',
    )
    expect(prisma.group.delete).not.toHaveBeenCalled()
  })

  it('причина — по факту: расписание без студентов называется расписанием', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.schedule.count.mockResolvedValue(1)
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'grp-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'schedule', message: 'расписание (1)' }],
    })
  })

  it('студенты в группе → CONFLICT «студенты»', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.count.mockResolvedValue(12)
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'grp-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'students', message: 'студенты (12)' }],
    })
    expect(prisma.group.delete).not.toHaveBeenCalled()
  })

  it('связь Restrict сработала мимо подсчёта (P2003) → всё равно CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.group.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' }),
    )
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'grp-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  it('админ чужого вуза → WRONG_SCOPE, до подсчёта', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    await expect(
      service.remove(viewer(Role.UNIVERSITY_ADMIN, { universityId: 'uni-2' }), 'grp-1', ctx),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
