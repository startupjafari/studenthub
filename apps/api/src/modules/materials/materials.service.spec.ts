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
    file: { findFirst: jest.fn().mockResolvedValue(null) },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const files = { upload: jest.fn(), findOrThrow: jest.fn(), getPresignedUrl: jest.fn() }
  const config = { get: jest.fn().mockReturnValue('materials') }
  const media = { describeOne: jest.fn().mockResolvedValue({ status: 'READY', sources: [] }) }
  const service = new MaterialsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
    media as never,
  )
  return { service, prisma, files, media }
}

const user = (role: Role, scope: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: scope.sub ?? 'u1',
  role,
  universityId: scope.universityId ?? null,
  facultyId: scope.facultyId ?? null,
  groupId: scope.groupId ?? null,
})

describe('MaterialsService.list — scope', () => {
  // where теперь { AND: [scope, ...фильтры] } — scope это AND[0]. Клиентские фильтры лишь
  // СУЖАЮТ scope и не могут его перезаписать (регрессия cross-tenant утечки).
  async function scopeOf(v: JwtPayload, query: Record<string, unknown> = {}) {
    const { service, prisma } = setup()
    await service.list(v, query as never)
    return prisma.material.findMany.mock.calls[0][0].where.AND
  }
  it('студент — только своя группа', async () => {
    const and = await scopeOf(user(Role.STUDENT, { groupId: 'g1' }))
    expect(and[0]).toEqual({ groupId: 'g1' })
  })
  it('декан — свой факультет', async () => {
    const and = await scopeOf(user(Role.DEAN, { facultyId: 'f1' }))
    expect(and[0]).toEqual({ group: { is: { facultyId: 'f1' } } })
  })
  it('преподаватель — свой вуз', async () => {
    const and = await scopeOf(user(Role.TEACHER, { universityId: 'uni1' }))
    expect(and[0]).toEqual({ group: { is: { faculty: { is: { universityId: 'uni1' } } } } })
  })
  // Регрессия: ?groupId=чужая-группа НЕ перезаписывает scope студента — в AND остаются оба
  // условия (своя группа И запрошенная), пересечение = пусто, чужие материалы не видны.
  it('студент не может подменить группу через ?groupId=', async () => {
    const and = await scopeOf(user(Role.STUDENT, { groupId: 'g1' }), { groupId: 'g2' })
    expect(and).toContainEqual({ groupId: 'g1' })
    expect(and).toContainEqual({ groupId: 'g2' })
  })
})

describe('MaterialsService.list — фильтры и страницы', () => {
  const teacher = user(Role.TEACHER, { sub: 't1', universityId: 'uni1' })

  it('mine — только свои материалы, а не поток всего вуза', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, { mine: true })
    const and = prisma.material.findMany.mock.calls[0][0].where.AND
    expect(and[0]).toEqual({ group: { is: { faculty: { is: { universityId: 'uni1' } } } } })
    expect(and).toContainEqual({ teacherId: 't1' })
  })

  it('subject — материалы дисциплины выбираются на сервере', async () => {
    const { service, prisma } = setup()
    await service.list(user(Role.STUDENT, { groupId: 'g1' }), { subject: 'Математика' })
    expect(prisma.material.findMany.mock.calls[0][0].where.AND).toContainEqual({
      subject: 'Математика',
    })
  })

  it('свежие сверху, следующая страница — по cursor, limit не выше потолка', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, { cursor: 'm-9', limit: 50 })
    expect(prisma.material.findMany.mock.calls[0][0]).toMatchObject({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      cursor: { id: 'm-9' },
      skip: 1,
    })
  })

  it('без limit — потолок 200', async () => {
    const { service, prisma } = setup()
    await service.list(teacher, {})
    expect(prisma.material.findMany.mock.calls[0][0].take).toBe(200)
  })
})

describe('MaterialsService.subjects — счётчики по дисциплинам', () => {
  it('считает по всей выборке scope, а не по странице списка', async () => {
    const { service, prisma } = setup()
    const groupBy = jest.fn().mockResolvedValue([
      { subject: 'Математика', _count: { _all: 240 } },
      { subject: null, _count: { _all: 3 } },
    ])
    ;(prisma.material as unknown as { groupBy: jest.Mock }).groupBy = groupBy
    const res = await service.subjects(user(Role.STUDENT, { groupId: 'g1' }), {})
    expect(res).toEqual([
      { subject: 'Математика', count: 240 },
      { subject: null, count: 3 },
    ])
    expect(groupBy.mock.calls[0][0].where.AND[0]).toEqual({ groupId: 'g1' })
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
    // Выборка ищет файл ВНУТРИ материала: чужой файл просто не находится.
    prisma.file.findFirst.mockResolvedValue(null)
    const err = await service
      .getFileUrl(user(Role.STUDENT, { groupId: 'g1' }), 'm1', 'f1')
      .catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.file.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1', materialId: 'm1' } }),
    )
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('getFileUrl: свой файл → ссылка и описание медиа', async () => {
    const { service, prisma, files } = setup()
    prisma.material.findUnique.mockResolvedValue({
      id: 'm1',
      groupId: 'g1',
      teacher: {},
      media: [],
    })
    prisma.file.findFirst.mockResolvedValue({ id: 'f1', variants: [] })
    files.getPresignedUrl.mockResolvedValue('https://minio/f1')
    const link = await service.getFileUrl(user(Role.STUDENT, { groupId: 'g1' }), 'm1', 'f1')
    expect(link).toMatchObject({ url: 'https://minio/f1', status: 'READY' })
    expect(Date.parse(link.expiresAt)).toBeGreaterThan(Date.now())
  })
})
