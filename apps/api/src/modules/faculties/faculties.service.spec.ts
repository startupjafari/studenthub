import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { FacultyService } from './faculties.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { UniversityService } from '../universities/universities.service'
import type { InviteService } from '../invites/invites.service'
import type { UserService } from '../users/users.service'
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
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn(),
    },
    university: { findUnique: jest.fn() },
    // Что держит факультет от удаления (deletionBlockers): по умолчанию ничего.
    group: { count: jest.fn().mockResolvedValue(0) },
    user: { count: jest.fn().mockResolvedValue(0) },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  }
  // Колбэк-транзакция: в tx — тот же мок. Пакетная (список) задаётся в тесте.
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof prisma) => unknown)(prisma) : arg,
  )
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const universities = { invalidateStats: jest.fn().mockResolvedValue(undefined) }
  const invites = { revokePendingInScope: jest.fn().mockResolvedValue(0) }
  const users = { detachDeletedFromFaculty: jest.fn().mockResolvedValue(0) }
  const service = new FacultyService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    universities as unknown as UniversityService,
    invites as unknown as InviteService,
    users as unknown as UserService,
  )
  return { service, prisma, audit, universities, invites, users }
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

describe('FacultyService — название уникально в вузе', () => {
  // Двойной клик в мастере заводил «Факультет права» дважды — их потом не различить.
  it('create: такое название в вузе уже есть (без учёта регистра) → CONFLICT, ничего не создано', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue({ id: 'uni-1' })
    prisma.faculty.findFirst.mockResolvedValue({ id: 'fac-old' })
    await expect(
      service.create(
        viewer(Role.UNIVERSITY_ADMIN, 'uni-1'),
        { name: '  фит ', universityId: 'uni-1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: [{ field: 'name' }] })
    expect(prisma.faculty.findFirst).toHaveBeenCalledWith({
      where: { universityId: 'uni-1', name: { in: ['фит'], mode: 'insensitive' } },
      select: { id: true },
    })
    expect(prisma.faculty.create).not.toHaveBeenCalled()
  })

  it('create: проверка и запись — под локом на вуз, название без пробелов по краям', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue({ id: 'uni-1' })
    prisma.faculty.create.mockResolvedValue(FAC)
    await service.create(
      viewer(Role.UNIVERSITY_ADMIN, 'uni-1'),
      { name: ' ФИТ ', universityId: 'uni-1' },
      ctx,
    )
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.faculty.findFirst.mock.invocationCallOrder[0] as number,
    )
    expect(prisma.faculty.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'ФИТ', universityId: 'uni-1' } }),
    )
  })

  it('create: одни пробелы — VALIDATION_ERROR', async () => {
    const { service, prisma } = setup()
    prisma.university.findUnique.mockResolvedValue({ id: 'uni-1' })
    await expect(
      service.create(
        viewer(Role.UNIVERSITY_ADMIN, 'uni-1'),
        { name: '   ', universityId: 'uni-1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(prisma.faculty.create).not.toHaveBeenCalled()
  })

  it('update: переименование в чужое название → CONFLICT; свой же регистр — можно', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    prisma.faculty.findFirst.mockResolvedValue({ id: 'fac-2' })
    await expect(
      service.update(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'fac-1', { name: 'Право' }, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.faculty.update).not.toHaveBeenCalled()

    // Сам факультет из проверки исключён: «ФИТ» → «фит» не конфликт с собой.
    prisma.faculty.findFirst.mockResolvedValue(null)
    prisma.faculty.update.mockResolvedValue({ ...FAC, name: 'фит' })
    await service.update(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'fac-1', { name: 'фит' }, ctx)
    expect(prisma.faculty.findFirst.mock.calls[1][0].where).toEqual({
      universityId: 'uni-1',
      name: { in: ['фит'], mode: 'insensitive' },
      id: { not: 'fac-1' },
    })
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

  // Экран писал «есть группы», когда факультет держал декан или удалённый аккаунт.
  it('в ответе — что именно держит факультет; удаления нет', async () => {
    const { service, prisma } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    prisma.user.count.mockResolvedValue(1)
    await expect(service.remove(viewer(Role.PLATFORM_ADMIN), 'fac-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: [{ field: 'users', message: 'пользователи (1)' }],
    })
    expect(prisma.faculty.delete).not.toHaveBeenCalled()
  })

  it('удалённые аккаунты отвязываются до подсчёта и удаления не держат', async () => {
    const { service, prisma, users } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    prisma.faculty.delete.mockResolvedValue(FAC)
    await service.remove(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'fac-1', ctx)
    expect(users.detachDeletedFromFaculty).toHaveBeenCalledWith(prisma, 'fac-1')
    expect(users.detachDeletedFromFaculty.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.count.mock.invocationCallOrder[0] as number,
    )
    expect(prisma.faculty.delete).toHaveBeenCalledWith({ where: { id: 'fac-1' } })
  })

  it('ожидающие приглашения на факультет отзываются той же транзакцией, до удаления', async () => {
    const { service, prisma, invites, audit } = setup()
    prisma.faculty.findUnique.mockResolvedValue(FAC)
    prisma.faculty.delete.mockResolvedValue(FAC)
    invites.revokePendingInScope.mockResolvedValue(2)

    await service.remove(viewer(Role.UNIVERSITY_ADMIN, 'uni-1'), 'fac-1', ctx)

    expect(invites.revokePendingInScope).toHaveBeenCalledWith(prisma, { facultyId: 'fac-1' })
    expect(invites.revokePendingInScope.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.faculty.delete.mock.invocationCallOrder[0] as number,
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'faculty_deleted', metadata: { revokedInvites: 2 } }),
    )
  })
})
