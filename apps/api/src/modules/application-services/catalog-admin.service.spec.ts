import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type { UpsertApplicationServiceInput } from '@studenthub/shared-schemas'
import { CatalogAdminService } from './catalog-admin.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

const ctx = { ip: '127.0.0.1', userAgent: 'jest' }

function setup() {
  const tx = {
    applicationService: {
      create: jest.fn().mockResolvedValue({ id: 'svc-new' }),
      update: jest.fn().mockResolvedValue({ id: 'svc-1' }),
    },
    serviceRequirement: { upsert: jest.fn(), updateMany: jest.fn() },
    serviceFormField: { upsert: jest.fn(), updateMany: jest.fn() },
  }
  const prisma = {
    applicationCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    applicationService: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new CatalogAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    new ApplicationPolicy(),
  )
  return { service, prisma, tx, audit }
}

const uniAdmin: JwtPayload = {
  sub: 'ua-1',
  role: Role.UNIVERSITY_ADMIN,
  universityId: 'uni-1',
  facultyId: null,
  groupId: null,
}
const platformAdmin: JwtPayload = {
  sub: 'pa-1',
  role: Role.PLATFORM_ADMIN,
  universityId: null,
  facultyId: null,
  groupId: null,
}
const dean: JwtPayload = { ...uniAdmin, sub: 'dean-1', role: Role.DEAN, facultyId: 'fac-1' }

const input: UpsertApplicationServiceInput = {
  categoryId: 'cat-1',
  code: 'dorm-certificate',
  nameRu: 'Справка из общежития',
  nameKk: 'Жатақханадан анықтама',
  nameEn: 'Dormitory certificate',
  slaHours: 24,
  deliveryModes: ['ELECTRONIC'],
  requiresPickup: false,
  facultyScoped: true,
  active: true,
  sortOrder: 0,
  requirements: [
    {
      code: 'id-card',
      documentType: 'ID_CARD',
      titleRu: 'Удостоверение',
      titleKk: 'Куәлік',
      titleEn: 'ID card',
      required: true,
      allowStorage: true,
      allowUpload: true,
      maxFiles: 1,
    },
  ],
  formFields: [
    {
      code: 'room',
      type: 'TEXT',
      labelRu: 'Комната',
      labelKk: 'Бөлме',
      labelEn: 'Room',
      required: true,
    },
  ],
}

describe('CatalogAdminService — права', () => {
  it('декан каталог не ведёт', async () => {
    const { service } = setup()
    await expect(service.create(dean, input, ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('админ вуза создаёт услугу в своём вузе, а не шаблон', async () => {
    const { service, tx } = setup()

    await service.create(uniAdmin, input, ctx)

    expect(tx.applicationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ universityId: 'uni-1', code: 'dorm-certificate' }),
      }),
    )
  })

  it('админ платформы создаёт глобальный шаблон', async () => {
    const { service, tx } = setup()

    await service.create(platformAdmin, input, ctx)

    expect(tx.applicationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ universityId: null }) }),
    )
  })

  it('админ вуза не правит шаблон платформы — только настраивает копию', async () => {
    const { service, prisma, tx } = setup()
    prisma.applicationService.findUnique.mockResolvedValue({
      id: 'tpl-1',
      code: 'dorm-certificate',
      universityId: null,
    })

    await expect(service.update(uniAdmin, 'tpl-1', input, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(tx.applicationService.update).not.toHaveBeenCalled()
  })

  it('услуга чужого вуза — WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.applicationService.findUnique.mockResolvedValue({
      id: 'svc-2',
      code: 'dorm-certificate',
      universityId: 'uni-2',
    })

    await expect(service.update(uniAdmin, 'svc-2', input, ctx)).rejects.toMatchObject({
      code: 'WRONG_SCOPE',
    })
  })
})

describe('CatalogAdminService — сохранение', () => {
  it('код занят — CONFLICT (у шаблонов NULL в индексе дубль не ловит, проверяем сами)', async () => {
    const { service, prisma, tx } = setup()
    prisma.applicationService.findFirst.mockResolvedValue({ id: 'existing' })

    await expect(service.create(platformAdmin, input, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prisma.applicationService.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { universityId: null, code: 'dorm-certificate' } }),
    )
    expect(tx.applicationService.create).not.toHaveBeenCalled()
  })

  it('код услуги после создания не меняется', async () => {
    const { service, prisma } = setup()
    prisma.applicationService.findUnique.mockResolvedValue({
      id: 'svc-1',
      code: 'old-code',
      universityId: 'uni-1',
    })

    await expect(service.update(uniAdmin, 'svc-1', input, ctx)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })

  it('убранные требования и поля выключаются, а не удаляются', async () => {
    const { service, prisma, tx } = setup()
    prisma.applicationService.findUnique.mockResolvedValue({
      id: 'svc-1',
      code: 'dorm-certificate',
      universityId: 'uni-1',
    })

    await service.update(uniAdmin, 'svc-1', input, ctx)

    expect(tx.serviceRequirement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { serviceId_code: { serviceId: 'svc-1', code: 'id-card' } },
        update: expect.objectContaining({ active: true, sortOrder: 0 }),
      }),
    )
    expect(tx.serviceRequirement.updateMany).toHaveBeenCalledWith({
      where: { serviceId: 'svc-1', active: true, code: { notIn: ['id-card'] } },
      data: { active: false },
    })
    expect(tx.serviceFormField.updateMany).toHaveBeenCalledWith({
      where: { serviceId: 'svc-1', active: true, code: { notIn: ['room'] } },
      data: { active: false },
    })
  })

  it('поле без вариантов хранит NULL, а не пустой массив', async () => {
    const { service, tx } = setup()

    await service.create(uniAdmin, input, ctx)

    const call = tx.serviceFormField.upsert.mock.calls[0]?.[0] as {
      create: { options: unknown }
    }
    expect(call.create.options).toBe(Prisma.DbNull)
  })
})

describe('CatalogAdminService.customize', () => {
  const template = {
    id: 'tpl-1',
    categoryId: 'cat-1',
    universityId: null,
    code: 'study-certificate',
    nameRu: 'Справка',
    nameKk: 'Анықтама',
    nameEn: 'Certificate',
    descriptionRu: null,
    descriptionKk: null,
    descriptionEn: null,
    instructionsRu: null,
    instructionsKk: null,
    instructionsEn: null,
    slaHours: 8,
    deliveryModes: ['ELECTRONIC'],
    requiresPickup: false,
    facultyScoped: true,
    active: true,
    sortOrder: 1,
    requirements: [],
    formFields: [],
  }

  it('копирует шаблон в вуз админа с тем же кодом', async () => {
    const { service, prisma, tx } = setup()
    prisma.applicationService.findFirst
      .mockResolvedValueOnce(template) // сам шаблон
      .mockResolvedValueOnce(null) // код в вузе свободен

    await service.customize(uniAdmin, 'tpl-1', ctx)

    expect(tx.applicationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ universityId: 'uni-1', code: 'study-certificate' }),
      }),
    )
  })

  it('вторая копия того же шаблона — CONFLICT', async () => {
    const { service, prisma, tx } = setup()
    prisma.applicationService.findFirst
      .mockResolvedValueOnce(template)
      .mockResolvedValueOnce({ id: 'copy-1' })

    await expect(service.customize(uniAdmin, 'tpl-1', ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(tx.applicationService.create).not.toHaveBeenCalled()
  })

  it('админ платформы шаблон «под себя» не настраивает', async () => {
    const { service } = setup()
    await expect(service.customize(platformAdmin, 'tpl-1', ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
