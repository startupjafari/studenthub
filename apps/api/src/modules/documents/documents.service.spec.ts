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

const DAY = 24 * 60 * 60 * 1000

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
      updateManyAndReturn: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        title: 'Паспорт',
        owner: { firstName: 'Айгерим', lastName: 'Садыкова' },
      }),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    documentEvent: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    documentAccess: {
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    file: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    // Комплекты запросов с этим документом: по умолчанию документ никуда не приложен.
    documentSubmissionItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    documentSubmission: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    // Пустые оверрайды → эффективный каталог = статические 25 типов (валидация типов идёт по нему).
    documentType: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  }
  // Пакет операций — как раньше; колбэк получает тот же мок вместо клиента транзакции.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  )
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

  // Правило срока хранения вуза: тип ID_CARD, 30 дней после истечения.
  const RULE = { id: 't1', universityId: 'uni-1', typeId: 'ID_CARD', retentionDays: 30 }
  // Выборка документов к архиву (у неё в where есть тип) отдельно от стадий EXPIRED/EXPIRING.
  type FindArgs = { where: { type?: string; id?: { gt: string } } }

  it('sweepExpiry: архивация идёт от правил вуза — в выборке только документы с прошедшим сроком хранения', async () => {
    const { service, prisma } = setup()
    prisma.documentType.findMany.mockResolvedValue([RULE])
    prisma.document.findMany.mockImplementation(async (args: FindArgs) =>
      args.where.type ? [{ id: 'd9' }] : [],
    )
    prisma.document.updateManyAndReturn.mockResolvedValue([{ id: 'd9', ownerId: 'u1' }])
    const before = Date.now()
    const res = await service.sweepExpiry()
    expect(res.archived).toBe(1)
    // Правила — только типы с заданным сроком.
    expect(prisma.documentType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { retentionDays: { not: null } } }),
    )
    // Документы без срока хранения и с ненаступившим сроком в выборку не попадают вовсе:
    // раньше они занимали первую пачку из 500 и блокировали архивацию остальных.
    const archiveCall = prisma.document.findMany.mock.calls.find(
      ([args]: [FindArgs]) => args.where.type,
    )![0]
    expect(archiveCall.where).toEqual(
      expect.objectContaining({
        universityId: 'uni-1',
        type: 'ID_CARD',
        status: 'EXPIRED',
        deletedAt: null,
        archivedAt: null,
      }),
    )
    const cutoff = archiveCall.where.expiresAt.lt.getTime()
    expect(cutoff).toBeLessThanOrEqual(before - 30 * 24 * 60 * 60 * 1000 + 1000)
    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['d9'] }, status: 'EXPIRED' }),
        data: expect.objectContaining({ status: 'ARCHIVED' }),
      }),
    )
    expect(prisma.documentEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ documentId: 'd9', actorId: 'u1', action: 'ARCHIVE' })],
    })
  })

  it('sweepExpiry: архивация проходит все пачки курсором по id, а не одну первую', async () => {
    const { service, prisma } = setup()
    prisma.documentType.findMany.mockResolvedValue([RULE])
    const first = Array.from({ length: 500 }, (_, i) => ({ id: `d${String(i).padStart(3, '0')}` }))
    prisma.document.findMany.mockImplementation(async (args: FindArgs) => {
      if (!args.where.type) return []
      return args.where.id ? [{ id: 'd500' }] : first
    })
    // Часть первой пачки не обновилась (документ продлили) — курсор всё равно идёт дальше.
    prisma.document.updateManyAndReturn
      .mockResolvedValueOnce(first.slice(1).map((d) => ({ ...d, ownerId: 'u1' })))
      .mockResolvedValueOnce([{ id: 'd500', ownerId: 'u1' }])
    const res = await service.sweepExpiry()
    expect(res.archived).toBe(500)
    const archiveCalls = prisma.document.findMany.mock.calls.filter(
      ([args]: [FindArgs]) => args.where.type,
    )
    expect(archiveCalls).toHaveLength(2)
    expect(archiveCalls[1][0].where.id).toEqual({ gt: 'd499' })
  })

  it('sweepExpiry: правила сроков читаются страницами до исчерпания', async () => {
    const { service, prisma } = setup()
    const page = Array.from({ length: 500 }, (_, i) => ({
      ...RULE,
      id: `t${String(i).padStart(3, '0')}`,
    }))
    prisma.documentType.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([])
    await service.sweepExpiry()
    expect(prisma.documentType.findMany).toHaveBeenCalledTimes(2)
    expect(prisma.documentType.findMany.mock.calls[1][0].where).toEqual({
      retentionDays: { not: null },
      id: { gt: 't499' },
    })
  })

  const platformActor: JwtPayload = {
    sub: 'pa',
    role: Role.PLATFORM_ADMIN,
    universityId: null,
    facultyId: null,
    groupId: null,
  }

  it('platformFileUrls: спец-режим требует причину — пишет журнал+аудит и выдаёт URL', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.file.findMany.mockResolvedValue([{ id: 'f1' }])
    const urls = await service.platformFileUrls(platformActor, 'd1', ['f1'], 'проверка жалобы #12')
    expect(urls).toEqual({ f1: 'https://minio/signed' })
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

  // Суть батча: открытие карточки с четырьмя сканами — это ОДНО обращение, а не четыре строки
  // журнала. Состав пачки при этом обязан сохраниться в metadata.
  it('platformFileUrls: пачка файлов даёт ровно одну запись аудита со списком fileIds', async () => {
    const { service, prisma, audit } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.file.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }])
    const urls = await service.platformFileUrls(
      platformActor,
      'd1',
      ['f1', 'f2', 'f3', 'f4'],
      'проверка жалобы #12',
    )
    expect(Object.keys(urls)).toEqual(['f1', 'f2', 'f3', 'f4'])
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(prisma.documentEvent.create).toHaveBeenCalledTimes(1)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOCUMENT_PLATFORM_DOWNLOAD',
        metadata: expect.objectContaining({ fileIds: ['f1', 'f2', 'f3', 'f4'] }),
      }),
    )
  })

  it('platformFileUrls: чужой файл в пачке — отказ целиком, без выдачи и записи', async () => {
    const { service, prisma, files, audit } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.file.findMany.mockResolvedValue([{ id: 'f1' }])
    await expect(
      service.platformFileUrls(platformActor, 'd1', ['f1', 'alien'], 'проверка жалобы #12'),
    ).rejects.toThrow()
    expect(files.getPresignedUrl).not.toHaveBeenCalled()
    expect(audit.record).not.toHaveBeenCalled()
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

  it('гранты «Университет» и «факультет» не действуют для студента — только USER', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      ownerId: 'other',
      universityId: 'uni-1',
    })
    prisma.documentAccess.findFirst.mockResolvedValue(null)
    const peer = { ...actor(), facultyId: 'fac-1' }
    await service.getFileUrl(peer, 'd1', 'f1').catch(() => null)
    const or = prisma.documentAccess.findFirst.mock.calls[0][0].where.OR
    expect(or).toEqual([{ granteeType: 'USER', granteeId: 'me' }])
  })

  it('декан своего факультета попадает под оба гранта', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue({
      id: 'd1',
      ownerId: 'other',
      universityId: 'uni-1',
    })
    prisma.documentAccess.findFirst.mockResolvedValue(null)
    const dean = { ...actor(), role: Role.DEAN, facultyId: 'fac-1' }
    await service.getFileUrl(dean, 'd1', 'f1').catch(() => null)
    const or = prisma.documentAccess.findFirst.mock.calls[0][0].where.OR
    expect(or).toEqual(
      expect.arrayContaining([
        { granteeType: 'DEPARTMENT', granteeId: 'fac-1' },
        { granteeType: 'UNIVERSITY' },
      ]),
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

describe('DocumentsService — открытые мне документы (D-F10)', () => {
  const dean: JwtPayload = {
    sub: 'dean-1',
    role: Role.DEAN,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: null,
  }

  function grantRow(id: string) {
    return {
      id,
      granteeType: 'DEPARTMENT',
      reason: 'личное дело',
      grantedAt: new Date(),
      expiresAt: null,
      document: {
        id: `doc-${id}`,
        category: 'PERSONAL',
        type: 'PASSPORT',
        title: 'Паспорт',
        numberLast4: '4821',
        issuedBy: null,
        issuedAt: null,
        expiresAt: null,
        status: 'UPLOADED',
        files: [{ id: 'f1', mime: 'application/pdf', size: 10, order: 0 }],
        owner: { id: 'stu-1', firstName: 'Айгерим', lastName: 'Садыкова' },
      },
    }
  }

  it('декан видит гранты на себя, свой факультет и свой вуз; номер — только маской', async () => {
    const { service, prisma } = setup()
    prisma.documentAccess.findMany.mockResolvedValue([grantRow('a1')])
    const res = await service.listSharedWithMe(dean, { limit: 20 })
    const where = prisma.documentAccess.findMany.mock.calls[0][0].where
    expect(where.revokedAt).toBeNull()
    expect(where.document).toEqual({ deletedAt: null, ownerId: { not: 'dean-1' } })
    expect(where.AND[1].OR).toEqual([
      { granteeType: 'USER', granteeId: 'dean-1' },
      { granteeType: 'DEPARTMENT', granteeId: 'fac-1' },
      // Грант «Университет» — только на документы своего вуза.
      { granteeType: 'UNIVERSITY', document: { universityId: 'uni-1' } },
    ])
    expect(res.items).toHaveLength(1)
    const item = res.items[0]!
    expect(item.owner).toEqual({ id: 'stu-1', name: 'Садыкова Айгерим' })
    expect(item.document.numberMasked).toBe('******4821')
    expect((item.document as unknown as Record<string, unknown>).numberLast4).toBeUndefined()
    expect(item.document.fileCount).toBe(1)
    expect(res.meta).toEqual({ cursor: undefined, hasNext: false })
  })

  it('студенту — только персональные гранты', async () => {
    const { service, prisma } = setup()
    await service.listSharedWithMe({ ...actor(), facultyId: 'fac-1' }, { limit: 20 })
    const where = prisma.documentAccess.findMany.mock.calls[0][0].where
    expect(where.AND[1].OR).toEqual([{ granteeType: 'USER', granteeId: 'me' }])
  })

  it('cursor-пагинация: limit + 1 строк → hasNext и курсор на последний грант страницы', async () => {
    const { service, prisma } = setup()
    prisma.documentAccess.findMany.mockResolvedValue([grantRow('a1'), grantRow('a2')])
    const res = await service.listSharedWithMe(dean, { limit: 1, cursor: 'a0' })
    const args = prisma.documentAccess.findMany.mock.calls[0][0]
    expect(args.take).toBe(2)
    expect(args.cursor).toEqual({ id: 'a0' })
    expect(args.skip).toBe(1)
    expect(res.items).toHaveLength(1)
    expect(res.meta).toEqual({ cursor: 'a1', hasNext: true })
  })

  it('grantAccess DEPARTMENT: уведомление деканам факультета в вузе владельца', async () => {
    const { service, prisma, queue } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.user.findMany.mockResolvedValue([{ id: 'dean-1' }])
    await service.grantAccess({ ...actor(), facultyId: 'fac-1' }, 'd1', {
      granteeType: 'DEPARTMENT',
      granteeId: 'fac-1',
      reason: 'личное дело',
    })
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          universityId: 'uni-1',
          role: Role.DEAN,
          facultyId: 'fac-1',
          deletedAt: null,
          isBlocked: false,
        }),
      }),
    )
    const [, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('document-shared')
    expect(payload.recipientIds).toEqual(['dean-1'])
    expect(payload.titleKey).toBe('documents.shared.title')
    expect(payload.params).toEqual({ name: 'Айгерим Садыкова', title: 'Паспорт' })
    expect(payload.dedupeKey).toBe('doc-shared:a1')
  })

  it('grantAccess USER: получатель вне вуза владельца не уведомляется', async () => {
    const { service, prisma, queue } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.user.findMany.mockResolvedValue([])
    await service.grantAccess(actor(), 'd1', {
      granteeType: 'USER',
      granteeId: 'stranger',
      reason: 'проверка',
    })
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ universityId: 'uni-1', id: 'stranger' }),
      }),
    )
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('grantAccess UNIVERSITY: без рассылки — грант виден администрации в «Открытых мне»', async () => {
    const { service, prisma, queue } = setup()
    prisma.document.findFirst.mockResolvedValue({ id: 'd1' })
    await service.grantAccess(actor(), 'd1', { granteeType: 'UNIVERSITY', reason: 'личное дело' })
    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('DocumentsService — выданные вузом и архив (D-F22)', () => {
  it('create: категорию «Выданные университетом» сам не завести → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    const err = await service
      .create(actor(), { category: 'ISSUED_BY_UNIVERSITY', type: 'STUDY_PLACE_REF', title: 'x' })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(prisma.document.create).not.toHaveBeenCalled()
  })

  it('update: данные выданного вузом документа не меняются; своя заметка — можно', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(row({ issuedByUniversity: true }))
    const later = new Date('2030-01-01')
    for (const input of [{ title: 'Другая' }, { number: '0000' }, { expiresAt: later }]) {
      const err = await service.update(actor(), 'd1', input).catch((e) => e)
      expect([input, err.code]).toEqual([input, 'FORBIDDEN'])
    }
    expect(prisma.document.update).not.toHaveBeenCalled()

    await service.update(actor(), 'd1', { comment: 'для стипендии' })
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { comment: 'для стипендии' },
    })
  })

  it('update: форма целиком с прежними данными у выданного вузом документа — не запрет', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(
      row({ issuedByUniversity: true, number: null, issuedBy: null }),
    )
    // Веб присылает все поля формы, даже нетронутые: важна правка, а не присутствие поля.
    await service.update(actor(), 'd1', { title: 'Удостоверение', issuedBy: '', comment: 'x' })
    expect(prisma.document.update).toHaveBeenCalled()
    expect(prisma.document.updateMany).not.toHaveBeenCalled()
  })

  it('attachFiles/reorderFiles: к выданному вузом документу страницы не добавить → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(row({ issuedByUniversity: true }))
    const attach = await service.attachFiles(actor(), 'd1', { fileIds: ['f1'] }).catch((e) => e)
    const reorder = await service.reorderFiles(actor(), 'd1', { fileIds: ['f1'] }).catch((e) => e)
    expect([attach.code, reorder.code]).toEqual(['FORBIDDEN', 'FORBIDDEN'])
    expect(prisma.file.update).not.toHaveBeenCalled()
  })

  it('архив запоминает прежний статус, возврат его восстанавливает', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValueOnce(row({ status: 'REJECTED' }))
    prisma.document.updateMany.mockResolvedValue({ count: 1 })
    await service.setArchived(actor(), 'd1', true)
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', archivedAt: null },
      data: expect.objectContaining({ status: 'ARCHIVED' }),
    })
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ARCHIVE',
          metadata: { archived: true, previousStatus: 'REJECTED' },
        }),
      }),
    )

    // Отозванная вузом справка из архива возвращается отозванной, а не «загруженной».
    prisma.document.findFirst.mockResolvedValueOnce(
      row({ status: 'ARCHIVED', archivedAt: new Date() }),
    )
    prisma.documentEvent.findFirst.mockResolvedValue({
      metadata: { archived: true, previousStatus: 'REJECTED' },
    })
    await service.setArchived(actor(), 'd1', false)
    expect(prisma.document.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'd1', archivedAt: { not: null } },
      data: { archivedAt: null, status: 'REJECTED' },
    })
  })

  it('возврат без известного статуса — по сроку: просроченный остаётся EXPIRED', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValueOnce(
      row({ status: 'ARCHIVED', archivedAt: new Date(), expiresAt: new Date(Date.now() - DAY) }),
    )
    prisma.documentEvent.findFirst.mockResolvedValue({ metadata: { retention: 30 } })
    prisma.document.updateMany.mockResolvedValue({ count: 1 })
    await service.setArchived(actor(), 'd1', false)
    expect(prisma.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null, status: 'EXPIRED' } }),
    )
  })

  it('повторный архив ничего не меняет — прежний статус не затирается ARCHIVED', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(row({ status: 'ARCHIVED', archivedAt: new Date() }))
    await service.setArchived(actor(), 'd1', true)
    expect(prisma.document.updateMany).not.toHaveBeenCalled()
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })
})

describe('DocumentsService — подтверждение вуза снимается правкой (D-F30)', () => {
  it('правка данных и порядка страниц возвращает VERIFIED в UPLOADED; заметка — нет', async () => {
    const { service, prisma } = setup()
    await service.update(actor(), 'd1', { comment: 'заметка' })
    expect(prisma.document.updateMany).not.toHaveBeenCalled()

    await service.update(actor(), 'd1', { title: 'IELTS 7.5' })
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'VERIFIED' },
      data: { status: 'UPLOADED' },
    })
  })
})

describe('DocumentsService — спец-режим: метаданные с причиной (D-F24)', () => {
  it('причина уходит в журнал документа и в аудит', async () => {
    const { service, prisma, audit } = setup()
    await service.platformGet(
      { ...actor('admin'), role: Role.PLATFORM_ADMIN },
      'd1',
      'Обращение в поддержку №12',
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'VIEW',
          metadata: { platformMode: true, meta: true, reason: 'Обращение в поддержку №12' },
        }),
      }),
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOCUMENT_PLATFORM_VIEW',
        metadata: { reason: 'Обращение в поддержку №12' },
      }),
    )
  })
})

describe('DocumentsService — страницы документа: замена, удаление, порядок', () => {
  it('replaceFile: новый файл встаёт на место старого с тем же порядком, старый удаляется', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findFirst
      .mockResolvedValueOnce({ id: 'old', order: 1 }) // заменяемая страница документа
      .mockResolvedValueOnce({ id: 'new' }) // свой неприкреплённый файл
    await service.replaceFile(actor(), 'd1', 'old', { fileId: 'new' })

    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: 'old', documentId: 'd1' },
      data: { documentId: null, order: null },
    })
    expect(prisma.file.updateMany).toHaveBeenCalledWith({
      where: { id: 'new', ownerId: 'me', documentId: null },
      data: { documentId: 'd1', order: 1 },
    })
    expect(files.delete).toHaveBeenCalledWith('old')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'REPLACE',
          metadata: { fileId: 'new', replacedFileId: 'old', order: 1 },
        }),
      }),
    )
    // Подтверждение вуза относится к прежнему скану.
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: 'VERIFIED' },
      data: { status: 'UPLOADED' },
    })
  })

  it('replaceFile: чужой или уже прикреплённый файл → BAD_REQUEST, ничего не трогаем', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findFirst.mockResolvedValueOnce({ id: 'old', order: 0 }).mockResolvedValueOnce(null)
    const err = await service
      .replaceFile(actor(), 'd1', 'old', { fileId: 'foreign' })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.file.updateMany).not.toHaveBeenCalled()
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('replaceFile: страница другого документа → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.file.findFirst.mockResolvedValueOnce(null)
    const err = await service.replaceFile(actor(), 'd1', 'x', { fileId: 'new' }).catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('replaceFile: гонка (страницу уже сняли) → CONFLICT, старый файл не удаляется', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findFirst
      .mockResolvedValueOnce({ id: 'old', order: 0 })
      .mockResolvedValueOnce({ id: 'new' })
    prisma.file.updateMany.mockResolvedValueOnce({ count: 0 })
    const err = await service.replaceFile(actor(), 'd1', 'old', { fileId: 'new' }).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('removeFile: снимает страницу, перенумеровывает остальные подряд, файл — из хранилища', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    await service.removeFile(actor(), 'd1', 'p2')

    expect(prisma.file.update).toHaveBeenCalledWith({
      where: { id: 'p2' },
      data: { documentId: null, order: null },
    })
    expect(prisma.file.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { order: 0 } })
    expect(prisma.file.update).toHaveBeenCalledWith({ where: { id: 'p3' }, data: { order: 1 } })
    expect(files.delete).toHaveBeenCalledWith('p2')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PAGE_REMOVE',
          metadata: { fileId: 'p2', order: 1 },
        }),
      }),
    )
  })

  it('removeFile: единственную страницу не удалить → BAD_REQUEST', async () => {
    const { service, prisma, files } = setup()
    prisma.file.findMany.mockResolvedValueOnce([{ id: 'p1' }])
    const err = await service.removeFile(actor(), 'd1', 'p1').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.file.update).not.toHaveBeenCalled()
    expect(files.delete).not.toHaveBeenCalled()
  })

  it('removeFile/replaceFile: выданный вузом документ → FORBIDDEN', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(row({ issuedByUniversity: true }))
    const rm = await service.removeFile(actor(), 'd1', 'p1').catch((e) => e)
    const rp = await service.replaceFile(actor(), 'd1', 'p1', { fileId: 'n' }).catch((e) => e)
    expect([rm.code, rp.code]).toEqual(['FORBIDDEN', 'FORBIDDEN'])
  })

  it('чужой документ — NOT_FOUND, без утечки существования', async () => {
    const { service, prisma } = setup()
    prisma.document.findFirst.mockResolvedValue(null)
    const err = await service.removeFile(actor('other'), 'd1', 'p1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
  })

  it('документ на проверке или принят по открытому запросу — содержимое не меняется (409)', async () => {
    const { service, prisma, files } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue({
      submission: { status: 'SUBMITTED' },
    })
    const results = await Promise.all([
      service.replaceFile(actor(), 'd1', 'p1', { fileId: 'n' }).catch((e) => e.code),
      service.removeFile(actor(), 'd1', 'p1').catch((e) => e.code),
      service.attachFiles(actor(), 'd1', { fileIds: ['n'] }).catch((e) => e.code),
      service.reorderFiles(actor(), 'd1', { fileIds: ['p1'] }).catch((e) => e.code),
      service.update(actor(), 'd1', { title: 'Новое' }).catch((e) => e.code),
    ])
    expect(results).toEqual(['CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT'])
    expect(prisma.documentSubmissionItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documentId: 'd1',
          submission: { status: { in: ['SUBMITTED', 'ACCEPTED'] }, request: { status: 'OPEN' } },
        },
      }),
    )
    expect(files.delete).not.toHaveBeenCalled()
    // Заметка — не содержимое: её правка в проверку не упирается.
    await expect(service.update(actor(), 'd1', { comment: 'x' })).resolves.toBeDefined()
  })

  it('правка страниц возвращает проверенный комплект в черновик и снимает вердикт позиции', async () => {
    const { service, prisma } = setup()
    prisma.file.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
    prisma.documentSubmissionItem.findMany.mockResolvedValue([
      { id: 'si1', submissionId: 's1' },
      { id: 'si2', submissionId: 's1' },
    ])
    await service.removeFile(actor(), 'd1', 'p2')

    expect(prisma.documentSubmissionItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documentId: 'd1',
          submission: {
            status: { in: ['DRAFT', 'REJECTED', 'PARTIAL'] },
            request: { status: 'OPEN' },
          },
        },
      }),
    )
    expect(prisma.documentSubmissionItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['si1', 'si2'] },
        submission: { status: { in: ['DRAFT', 'REJECTED', 'PARTIAL'] } },
      },
      data: { status: 'PENDING', rejectionReason: null, reviewedById: null, reviewedAt: null },
    })
    expect(prisma.documentSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1'] }, status: { in: ['REJECTED', 'PARTIAL'] } },
      data: { status: 'DRAFT' },
    })
  })

  it('attachFiles к загруженному документу пишет PAGE_ADD, а не REPLACE', async () => {
    const { service, prisma } = setup()
    prisma.file.findMany.mockResolvedValueOnce([{ id: 'n' }])
    prisma.file.count.mockResolvedValueOnce(2)
    await service.attachFiles(actor(), 'd1', { fileIds: ['n'] })
    expect(prisma.file.update).toHaveBeenCalledWith({
      where: { id: 'n' },
      data: { documentId: 'd1', order: 2 },
    })
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PAGE_ADD', metadata: { added: 1 } }),
      }),
    )
  })
})
