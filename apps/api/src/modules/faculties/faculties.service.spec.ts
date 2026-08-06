import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { FacultyService } from './faculties.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { UniversityService } from '../universities/universities.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    faculty: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    university: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }
  const service = new FacultyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
  )
  return { service, prisma, audit, universities }
}

function viewer(role: Role, universityId: string | null = null): JwtPayload {
  return { sub: 'u', role, universityId, facultyId: null, groupId: null }
}

const FAC = { id: 'fac-1', name: 'ФИТ', universityId: 'uni-1' }

describe('FacultyService — create', () => {
  it('UNIVERSITY_ADMIN своего вуза — создаёт и сбрасывает кэш', async () => {
    const { service, prisma, universities } = setup()
    prisma.university.findUnique.mockResolvedValue({ id: 'uni-1' })
    prisma.faculty.create.mockResolvedValue(FAC)
    await service.create(
      viewer(Role.UNIVERSITY_ADMIN, 'uni-1'),
      { name: 'ФИТ', universityId: 'uni-1' },
      ctx,
    )
    expect(prisma.faculty.create).toHaveBeenCalled()
    expect(universities.invalidateStats).toHaveBeenCalledWith('uni-1')
  })

  it('UNIVERSITY_ADMIN в чужой вуз → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    await expect(
      service.create(
        viewer(Role.UNIVERSITY_ADMIN, 'uni-2'),
        { name: 'X', universityId: 'uni-1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(prisma.faculty.create).not.toHaveBeenCalled()
  })

  it('несуществующий вуз → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue(null)
    await expect(
      service.create(viewer(Role.PLATFORM_ADMIN), { name: 'X', universityId: 'nope' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('FacultyService — scope чтения', () => {
  it('getById: свой вуз — ок, чужой — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    await expect(service.getById(viewer(Role.DEAN, 'uni-1'), 'fac-1')).resolves.toEqual(FAC)
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    await expect(service.getById(viewer(Role.DEAN, 'uni-2'), 'fac-1')).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })

  it('list: не-платформа принудительно фильтруется своим вузом', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockResolvedValue([[], 0])
    await service.list(viewer(Role.STUDENT, 'uni-9'), 1, 20, 'uni-1')
    const call = prisma.faculty.findMany.mock.calls[0][0]
    expect(call.where).toEqual({ universityId: 'uni-9' })
  })

  it('list: платформа с фильтром universityId', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockResolvedValue([[], 0])
    await service.list(viewer(Role.PLATFORM_ADMIN), 1, 20, 'uni-1')
    expect(prisma.faculty.findMany.mock.calls[0][0].where).toEqual({ universityId: 'uni-1' })
  })
})

describe('FacultyService — remove', () => {
  it('FK-нарушение (есть группы) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    prisma.faculty.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' }),
    )
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'fac-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})
