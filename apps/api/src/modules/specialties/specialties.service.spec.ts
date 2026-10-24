import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { SpecialtiesService } from './specialties.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { UserService } from '../users/users.service'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }
const admin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}

function setup() {
  const prisma = {
    specialty: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'sp-1', name: 'Информатика', universityId: 'uni-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'sp-2', name: 'Право' }),
      update: jest.fn().mockResolvedValue({ id: 'sp-1', name: 'Информатика' }),
      delete: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $transaction: jest.fn(),
  }
  // Колбэк-транзакция: в tx — тот же мок.
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma))
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const users = { renameSpecialty: jest.fn().mockResolvedValue(0) }
  const service = new SpecialtiesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    users as unknown as UserService,
  )
  return { service, prisma, audit, users }
}

describe('SpecialtiesService.update', () => {
  it('переименовывает специальность своего вуза, обрезая пробелы', async () => {
    const { service, prisma } = setup()
    await service.update(admin, 'sp-1', { name: '  Информатика ' }, ctx)
    expect(prisma.specialty.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sp-1' }, data: { name: 'Информатика' } }),
    )
  })

  it('специальность другого вуза — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.specialty.findUnique.mockResolvedValue({ id: 'sp-1', universityId: 'uni-2' })
    await expect(service.update(admin, 'sp-1', { name: 'X' }, ctx)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
    expect(prisma.specialty.update).not.toHaveBeenCalled()
  })

  it('такое название уже есть — CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.specialty.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('u', { code: 'P2002', clientVersion: '6' }),
    )
    await expect(service.update(admin, 'sp-1', { name: 'Дубль' }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })

  // Уникальный индекс различает регистр: «право» рядом с «Право» он пропускал.
  it('то же название в другом регистре у другой специальности — CONFLICT, ничего не меняется', async () => {
    const { service, prisma, users } = setup()
    prisma.specialty.findFirst.mockResolvedValue({ id: 'sp-9', name: 'Право' })
    await expect(service.update(admin, 'sp-1', { name: 'право' }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.specialty.findFirst).toHaveBeenCalledWith({
      where: {
        universityId: 'uni-1',
        name: { in: ['право'], mode: 'insensitive' },
        id: { not: 'sp-1' },
      },
      select: { id: true, name: true },
    })
    expect(prisma.specialty.update).not.toHaveBeenCalled()
    expect(users.renameSpecialty).not.toHaveBeenCalled()
  })

  // В профиле специальность — строка: без каскада в справках оставалось старое название.
  it('новое название доходит до учебных данных студентов вуза той же транзакцией', async () => {
    const { service, prisma, users, audit } = setup()
    prisma.specialty.update.mockResolvedValue({ id: 'sp-1', name: 'Информатика и ВТ' })
    users.renameSpecialty.mockResolvedValue(42)

    await service.update(admin, 'sp-1', { name: 'Информатика и ВТ' }, ctx)

    expect(users.renameSpecialty).toHaveBeenCalledWith(
      prisma,
      'uni-1',
      'Информатика',
      'Информатика и ВТ',
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'specialty_updated',
        metadata: { from: 'Информатика', to: 'Информатика и ВТ', renamedProfiles: 42 },
      }),
    )
  })

  it('название не изменилось — профили не трогаются', async () => {
    const { service, users } = setup()
    await service.update(admin, 'sp-1', { name: 'Информатика ' }, ctx)
    expect(users.renameSpecialty).not.toHaveBeenCalled()
  })
})

describe('SpecialtiesService.create', () => {
  it('дубль без учёта регистра — CONFLICT под локом на вуз', async () => {
    const { service, prisma } = setup()
    prisma.specialty.findFirst.mockResolvedValue({ id: 'sp-1', name: 'Информатика' })
    await expect(service.create(admin, { name: 'ИНФОРМАТИКА' }, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(prisma.specialty.create).not.toHaveBeenCalled()
  })

  it('новое название — создаётся в вузе из JWT', async () => {
    const { service, prisma } = setup()
    await service.create(admin, { name: ' Право ' }, ctx)
    expect(prisma.specialty.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Право', universityId: 'uni-1' } }),
    )
  })
})
