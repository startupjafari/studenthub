import { Role } from '@studenthub/shared-types'
import type { ConfigService } from '@nestjs/config'
import { DocumentsService } from './documents.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { FileService } from '../files/file.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { QueueService } from '../../common/queue'
import { DocumentTypesService } from './document-types.service'
import type { AuditService } from '../../common/audit/audit.service'

function actor(sub = 'me'): JwtPayload {
  return { sub, role: Role.STUDENT, universityId: 'uni-1', facultyId: null, groupId: null }
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    category: 'PERSONAL',
    type: 'ID_CARD',
    title: 'Удостоверение',
    numberLast4: '4821',
    issuedBy: null,
    issuedAt: null,
    expiresAt: null,
    comment: null,
    status: 'UPLOADED',
    rejectionReason: null,
    issuedByUniversity: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    files: [],
    _count: { access: 0 },
    ...over,
  }
}

function setup() {
  const prisma = {
    document: {
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
      findFirst: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
    },
    documentEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    documentAccess: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    file: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    // Пустые оверрайды → эффективный каталог = статические 25 типов (валидация типов идёт по нему).
    documentType: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const files = {
    upload: jest.fn(),
    delete: jest.fn(),
    getPresignedUrl: jest.fn().mockResolvedValue('https://minio/signed'),
  }
  const config = { get: jest.fn().mockReturnValue('documents') }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const types = new DocumentTypesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  const service = new DocumentsService(
    prisma as unknown as PrismaService,
    files as unknown as FileService,
    config as unknown as ConfigService<EnvVars, true>,
    queue as unknown as QueueService,
    types,
    audit as unknown as AuditService,
  )
  return { service, prisma, files, queue, types, audit }
}

describe('DocumentsService', () => {
  it('create: маскирует номер (numberLast4) и хранит полный номер; наружу — только маска', async () => {
    const { service, prisma } = setup()
    const dto = await service.create(actor(), {
      category: 'PERSONAL',
      type: 'ID_CARD',
      title: 'Удостоверение',
      number: '1234 5678 4821',
    })
    const data = prisma.document.create.mock.calls[0][0].data
    expect(data.number).toBe('1234 5678 4821')
    expect(data.numberLast4).toBe('4821')
    expect(dto.numberMasked).toBe('******4821')
    // Полный номер НЕ должен присутствовать в DTO.
    expect((dto as unknown as Record<string, unknown>).number).toBeUndefined()
  })

  it('create: неизвестный тип для категории → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service
      .create(actor(), { category: 'PERSONAL', type: 'NOPE', title: 'x' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('uploadFile: не PDF/JPG/PNG → откат + FILE_TYPE_NOT_ALLOWED', async () => {
    const { service, files } = setup()
    files.upload.mockResolvedValue({ id: 'f1', mime: 'application/zip', size: 10 })
    const err = await service.uploadFile(actor(), Buffer.from('x')).catch((e) => e)
    expect(err.code).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(files.delete).toHaveBeenCalledWith('f1', 'me')
  })

  it('getFileUrl: чужой документ → NOT_FOUND, presigned не выдаётся', async () => {
    const { service, prisma, files } = setup()
    prisma.document.findFirst.mockResolvedValue(null)
    const err = await service.getFileUrl(actor(), 'd1', 'f1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })

  it('overview: собирает пять счётчиков', async () => {
    const { service, prisma } = setup()
    prisma.$transaction.mockResolvedValue([5, 1, 0, 2, 1])
    const res = await service.overview(actor())
    expect(res).toEqual({
      total: 5,
      toUpload: 1,
      inReview: 0,
      expiringSoon: 2,
      needsReplacement: 1,
    })
  })

  it('sweepExpiry: просроченный → EXPIRED + уведомление владельцу + событие EXPIRE', async () => {
    const { service, prisma, queue } = setup()
    prisma.document.findMany
      .mockResolvedValueOnce([{ id: 'd1', ownerId: 'u1', title: 'Паспорт' }]) // стадия EXPIRED
      .mockResolvedValue([]) // затем пусто (и стадия EXPIRING)
    const res = await service.sweepExpiry()
    expect(res.expired).toBe(1)
    expect(prisma.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'EXPIRED' } }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'EXPIRE' }) }),
    )
    const [, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('document-expiring')
    expect(payload.recipientIds).toEqual(['u1'])
    expect(payload.dedupeKey).toBe('doc-expired:d1')
    expect(payload.type).toBe('SYSTEM')
  })

  it('platformFileUrl: спец-режим требует причину — пишет журнал+аудит и выдаёт URL', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
    const platform: JwtPayload = {
      sub: 'pa',
      role: Role.PLATFORM_ADMIN,
      universityId: null,
      facultyId: null,
      groupId: null,
    }
    const url = await service.platformFileUrl(platform, 'd1', 'f1', 'проверка жалобы #12')
    expect(url).toBe('https://minio/signed')
    expect(files.getPresignedUrl).toHaveBeenCalledWith('f1')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VIEW',
          metadata: expect.objectContaining({ platformMode: true, reason: 'проверка жалобы #12' }),
        }),
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOCUMENT_PLATFORM_DOWNLOAD', entityId: 'd1' }),
    )
  })

  it('remove: мягкое удаление + событие DELETE', async () => {
    const { service, prisma } = setup()
    await service.remove(actor(), 'd1')
    expect(prisma.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'DELETE' }) }),
    )
  })
})

describe('DocumentsService — доступ (15.11)', () => {
  it('grantAccess: DEPARTMENT без granteeId → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    const err = await service
      .grantAccess(actor(), 'd1', { granteeType: 'DEPARTMENT', reason: 'дело' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentAccess.create).not.toHaveBeenCalled()
  })

  it('grantAccess: UNIVERSITY → granteeId=null, событие GRANT', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    await service.grantAccess(actor(), 'd1', { granteeType: 'UNIVERSITY', reason: 'личное дело' })
    const data = prisma.documentAccess.create.mock.calls[0][0].data
    expect(data.granteeId).toBeNull()
    expect(data.granteeType).toBe('UNIVERSITY')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'GRANT' }) }),
    )
  })

  it('revokeAccess: ставит revokedAt + событие REVOKE', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.documentAccess.findFirst.mockResolvedValue({ id: 'a1', revokedAt: null })
    await service.revokeAccess(actor(), 'd1', 'a1')
    expect(prisma.documentAccess.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1' }, data: { revokedAt: expect.any(Date) } }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REVOKE' }) }),
    )
  })

  it('getFileUrl: не владелец с активным грантом → выдаёт URL (событие VIEW)', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      ownerId: 'other',
      universityId: 'uni-1',
    })
    prisma.documentAccess.findFirst.mockResolvedValue({ id: 'g1' })
    prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
    const url = await service.getFileUrl(actor(), 'd1', 'f1')
    expect(url).toBe('https://minio/signed')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'VIEW' }) }),
    )
  })

  it('getFileUrl: не владелец без гранта → NOT_FOUND', async () => {
    const { service, prisma, files } = setup()
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      ownerId: 'other',
      universityId: 'uni-2',
    })
    prisma.documentAccess.findFirst.mockResolvedValue(null)
    const err = await service.getFileUrl(actor(), 'd1', 'f1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
  })
})
