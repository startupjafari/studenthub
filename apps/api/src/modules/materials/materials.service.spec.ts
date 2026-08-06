import { Role } from '@studenthub/shared-types'
import { MaterialsService } from './materials.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { FileService } from '../files/file.service'
import type { ConfigService } from '@nestjs/config'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const prisma = {
    material: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'm-new' }),
      delete: jest.fn(),
    },
    group: { findUnique: jest.fn() },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const files = { upload: jest.fn(), findOrThrow: jest.fn(), getPresignedUrl: jest.fn() }
  const config = { get: jest.fn().mockReturnValue('materials') }
  const service = new MaterialsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, prisma, files }
}

const user = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: scope.sub ?? 'u1',
  role,
  universityId: scope.universityId ?? null,
  facultyId: scope.facultyId ?? null,
  groupId: scope.groupId ?? null,
})

describe('MaterialsService.list — scope', () => {
  async function whereFor(v: JwtPayload) {
    const { service, prisma } = setup()
    await service.list(v, {})
    return prisma.material.findMany.mock.calls[0][0].where
  }
  it('студент — только своя группа', async () => {
    const where = await whereFor(user(Role.STUDENT, { groupId: 'g1' }))
    expect(where.groupId).toBe('g1')
  })
  it('декан — свой факультет', async () => {
    const where = await whereFor(user(Role.DEAN, { facultyId: 'f1' }))
    expect(where.group).toEqual({ is: { facultyId: 'f1' } })
  })
  it('преподаватель — свой вуз', async () => {
    const where = await whereFor(user(Role.TEACHER, { universityId: 'uni1' }))
    expect(where.group).toEqual({ is: { faculty: { is: { universityId: 'uni1' } } } })
  })
})

describe('MaterialsService.create — scope группы', () => {
  it('преподаватель чужого вуза → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uniX' },
    })
    const err = await service
      .create(user(Role.TEACHER, { universityId: 'uni1' }), { groupId: 'g1', title: 'T' }, ctx)
      .catch((e) => e)
    expect(err.code).toBe('WRONG_SCOPE')
  })
  it('преподаватель своего вуза → создаёт', async () => {
    const { service, prisma } = setup()
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const res = await service.create(
      user(Role.TEACHER, { universityId: 'uni1' }),
      { groupId: 'g1', title: 'T' },
      ctx,
    )
    expect(res.id).toBe('m-new')
  })
})

describe('MaterialsService — управление своими', () => {
  it('чужой материал преподавателем → FORBIDDEN при удалении', async () => {
    const { service, prisma } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'other', groupId: 'g1' })
    prisma.group.findUnique.mockResolvedValue({
      facultyId: 'f1',
      faculty: { universityId: 'uni1' },
    })
    const err = await service
      .remove(user(Role.TEACHER, { sub: 'u1', universityId: 'uni1' }), 'm1', ctx)
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })
  it('свой материал → удаляется', async () => {
    const { service, prisma } = setup()
    prisma.material.findUnique.mockResolvedValue({ id: 'm1', teacherId: 'u1', groupId: 'g1' })
    prisma.material.delete.mockResolvedValue({})
    await service.remove(user(Role.TEACHER, { sub: 'u1' }), 'm1', ctx)
    expect(prisma.material.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('getFileUrl: файл не из этого материала → NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      teacher: {},
      media: [],
    })
    files.findOrThrow.mockResolvedValue({ materialId: 'other' })
    const err = await service
      .getFileUrl(user(Role.STUDENT, { groupId: 'g1' }), 'm1', 'f1')
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })
})
