import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { GroupService } from './groups.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { UniversityService } from '../universities/universities.service'
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
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }
  const service = new GroupService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
  )
  return { service, prisma, audit, universities }
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
    prisma.user.findFirst.mockResolvedValue({ id: 'stud-1', groupId: 'grp-1' })
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
    prisma.user.findFirst.mockResolvedValue({ id: 'x', groupId: 'grp-9' })
    await expect(
      service.assignStarosta(viewer(Role.PLATFORM_ADMIN), 'grp-1', { starostaId: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('пользователь уже староста другой группы (P2002) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.user.findFirst.mockResolvedValue({ id: 'stud-1', groupId: 'grp-1' })
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

describe('GroupService — remove', () => {
  it('есть студенты (P2003) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue(GROUP)
    prisma.group.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' }),
    )
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'grp-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})
