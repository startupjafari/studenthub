import { Role } from '@studenthub/shared-types'
import { DocumentTypesService } from './document-types.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { AuditService } from '../../common/audit/audit.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

function admin(): JwtPayload {
  return {
    sub: 'a1',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni-1',
    facultyId: null,
    groupId: null,
  }
}

function setup(overrides: unknown[] = []) {
  const prisma = {
    documentType: {
      findMany: jest.fn().mockResolvedValue(overrides),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const service = new DocumentTypesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  return { service, prisma, audit }
}

describe('DocumentTypesService (15.20)', () => {
  it('effective: без оверрайдов = статический каталог, все включены', async () => {
    const { service } = setup()
    const catalog = await service.effective('uni-1')
    expect(catalog.length).toBeGreaterThanOrEqual(25)
    expect(catalog.every((t) => t.enabled)).toBe(true)
    expect(catalog.find((t) => t.typeId === 'ID_CARD')?.category).toBe('PERSONAL')
  })

  it('effective: оверрайд выключает тип и задаёт срок хранения; custom добавляется', async () => {
    const { service } = setup([
      {
        typeId: 'ID_CARD',
        custom: false,
        enabled: false,
        retentionDays: 365,
        category: null,
        label: null,
        fields: [],
      },
      {
        typeId: 'STUDENT_CARD_X',
        custom: true,
        enabled: true,
        retentionDays: null,
        category: 'ACADEMIC',
        label: 'Студкарта',
        fields: ['comment'],
      },
    ])
    const catalog = await service.effective('uni-1')
    expect(catalog.find((t) => t.typeId === 'ID_CARD')?.enabled).toBe(false)
    expect(catalog.find((t) => t.typeId === 'ID_CARD')?.retentionDays).toBe(365)
    const custom = catalog.find((t) => t.typeId === 'STUDENT_CARD_X')
    expect(custom?.custom).toBe(true)
    expect(custom?.label).toBe('Студкарта')
  })

  it('resolveUsable: выключенный тип → BAD_REQUEST', async () => {
    const { service } = setup([
      {
        typeId: 'ID_CARD',
        custom: false,
        enabled: false,
        retentionDays: null,
        category: null,
        label: null,
        fields: [],
      },
    ])
    const err = await service.resolveUsable('uni-1', 'ID_CARD').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('resolveUsable: неизвестный тип → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service.resolveUsable('uni-1', 'NOPE').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('addCustom: код совпал со стандартным → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service
      .addCustom(admin(), { code: 'ID_CARD', category: 'PERSONAL', label: 'x' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('addCustom: успех → create + аудит', async () => {
    const { service, prisma, audit } = setup()
    await service.addCustom(admin(), {
      code: 'CLUB_CARD',
      category: 'PERSONAL',
      label: 'Клубная карта',
    })
    expect(prisma.documentType.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ typeId: 'CLUB_CARD', custom: true }),
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_TYPE_CREATE', entityId: 'CLUB_CARD' }),
    )
  })

  it('updateType: статический тип → upsert + аудит', async () => {
    const { service, prisma, audit } = setup()
    await service.updateType(admin(), 'ID_CARD', { enabled: false, retentionDays: 30 })
    expect(prisma.documentType.upsert).toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_TYPE_UPDATE', entityId: 'ID_CARD' }),
    )
  })
})
