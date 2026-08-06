import { Role } from '@studenthub/shared-types'
import { DocumentRequestsService } from './document-requests.service'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { DocumentsService } from './documents.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { QueueService } from '../../common/queue'
import { DocumentTypesService } from './document-types.service'
import type { AuditService } from '../../common/audit/audit.service'

function staff(role: Role = Role.DEAN): JwtPayload {
  return { sub: 'staff-1', role, universityId: 'uni-1', facultyId: 'fac-1', groupId: null }
}
function student(): JwtPayload {
  return {
    sub: 'stu-1',
    role: Role.STUDENT,
    universityId: 'uni-1',
    facultyId: 'fac-1',
    groupId: 'grp-1',
  }
}

function setup() {
  const prisma = {
    documentRequest: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({
        id: 'r1',
        title: 'Комплект',
        description: null,
        dueAt: null,
        status: 'OPEN',
        createdAt: new Date(),
        items: [],
        targets: [],
        submissions: [],
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    documentSubmission: {
      findFirst: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ id: 's1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    documentSubmissionItem: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    documentRequestTarget: { findMany: jest.fn().mockResolvedValue([]) },
    document: { count: jest.fn().mockResolvedValue(0) },
    documentEvent: { create: jest.fn().mockResolvedValue({}) },
    documentType: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((ops: unknown) => Promise.all(ops as Promise<unknown>[])),
  }
  const documents = { presign: jest.fn().mockResolvedValue('https://minio/signed') }
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const audit = { record: jest.fn().mockResolvedValue(undefined) }
  const types = new DocumentTypesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  )
  const service = new DocumentRequestsService(
    prisma as unknown as PrismaService,
    documents as unknown as DocumentsService,
    queue as unknown as QueueService,
    types,
  )
  return { service, prisma, documents, queue }
}

const OK_ITEM = { documentType: 'ID_CARD', title: 'Удостоверение', required: true }

describe('DocumentRequestsService — создание запроса (15.14)', () => {
  it('не сотрудник (студент) → FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service
      .createRequest(student(), {
        title: 'x',
        items: [OK_ITEM],
        targets: [{ targetType: 'UNIVERSITY' }],
      })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('неизвестный тип документа в позиции → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service
      .createRequest(staff(), {
        title: 'x',
        items: [{ documentType: 'NOPE', title: 't' }],
        targets: [{ targetType: 'UNIVERSITY' }],
      })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('адресат FACULTY без targetId → BAD_REQUEST', async () => {
    const { service } = setup()
    const err = await service
      .createRequest(staff(), {
        title: 'x',
        items: [OK_ITEM],
        targets: [{ targetType: 'FACULTY' }],
      })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('§15.2: админ вуза не участвует в запросах → FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service
      .createRequest(staff(Role.UNIVERSITY_ADMIN), {
        title: 'x',
        items: [OK_ITEM],
        targets: [{ targetType: 'UNIVERSITY' }],
      })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('§15.2: преподаватель запрашивает неучебный тип → FORBIDDEN', async () => {
    const { service } = setup()
    const err = await service
      .createRequest(staff(Role.TEACHER), {
        title: 'x',
        items: [{ documentType: 'ID_CARD', title: 'Удостоверение' }], // PERSONAL
        targets: [{ targetType: 'UNIVERSITY' }],
      })
      .catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('§15.2: преподаватель запрашивает учебный тип → успех', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    await service.createRequest(staff(Role.TEACHER), {
      title: 'Дипломы',
      items: [{ documentType: 'DIPLOMA', title: 'Диплом' }], // ACADEMIC
      targets: [{ targetType: 'UNIVERSITY' }],
    })
    expect(prisma.documentRequest.create).toHaveBeenCalled()
  })

  it('успех: создаёт запрос, UNIVERSITY-адресат → targetId=null, событие REQUEST_CREATE', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' }) // findAuthoredOrThrow
    await service.createRequest(staff(), {
      title: 'Комплект',
      items: [OK_ITEM],
      targets: [{ targetType: 'UNIVERSITY' }],
    })
    const data = prisma.documentRequest.create.mock.calls[0][0].data
    expect(data.universityId).toBe('uni-1')
    expect(data.targets.create[0].targetId).toBeNull()
    expect(data.items.create[0].order).toBe(0)
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'REQUEST_CREATE', requestId: 'r1' }),
      }),
    )
  })
})

describe('DocumentRequestsService — проверка (15.16)', () => {
  it('reviewItem REJECTED: пишет причину + событие REJECT', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue({
      id: 'si1',
      submission: { id: 's1', requestId: 'r1' },
    })
    prisma.documentSubmission.findFirst.mockResolvedValue({
      id: 's1',
      status: 'SUBMITTED',
      submittedAt: null,
      reviewedAt: null,
      request: { id: 'r1', title: 't' },
      student: { id: 'stu-1', firstName: 'И', lastName: 'И' },
      items: [],
    })
    await service.reviewItem(staff(), 'si1', { status: 'REJECTED', rejectionReason: 'нечитаемо' })
    expect(prisma.documentSubmissionItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'нечитаемо' }),
      }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REJECT' }) }),
    )
  })

  it('finalize: любая REJECTED-позиция → комплект REJECTED + уведомление студенту', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce({
        id: 's1',
        requestId: 'r1',
        studentId: 'stu-1',
        request: { title: 'Комплект' },
        items: [{ status: 'ACCEPTED' }, { status: 'REJECTED' }],
      })
      .mockResolvedValue({
        id: 's1',
        status: 'REJECTED',
        submittedAt: null,
        reviewedAt: null,
        request: { id: 'r1', title: 't' },
        student: { id: 'stu-1', firstName: 'И', lastName: 'И' },
        items: [],
      })
    await service.finalizeSubmission(staff(), 's1')
    expect(prisma.documentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    )
    const [, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('document-result')
    expect(payload.recipientIds).toEqual(['stu-1'])
    expect(payload.dedupeKey).toBe('doc-result:s1:REJECTED')
  })

  it('finalize: все ACCEPTED → комплект ACCEPTED', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce({
        id: 's1',
        requestId: 'r1',
        studentId: 'stu-1',
        request: { title: 'Комплект' },
        items: [{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }],
      })
      .mockResolvedValue({
        id: 's1',
        status: 'ACCEPTED',
        submittedAt: null,
        reviewedAt: null,
        request: { id: 'r1', title: 't' },
        student: { id: 'stu-1', firstName: 'И', lastName: 'И' },
        items: [],
      })
    await service.finalizeSubmission(staff(), 's1')
    expect(prisma.documentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    )
  })

  it('getSubmissionFileUrl: не сотрудник → FORBIDDEN', async () => {
    const { service, documents } = setup()
    const err = await service.getSubmissionFileUrl(student(), 'si1', 'f1').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(documents.presign).not.toHaveBeenCalled()
  })
})

describe('DocumentRequestsService — ответ студента (15.15)', () => {
  it('saveSubmission: чужой/несуществующий документ → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1', items: [{ id: 'it1' }] })
    prisma.document.count.mockResolvedValue(0) // документ не принадлежит студенту
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'doc-x' }] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('submitSubmission: не заполнена обязательная позиция → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({
      id: 'r1',
      items: [{ id: 'req-required' }],
      submissions: [{ id: 's1', items: [] }], // ничего не привязано
    })
    const err = await service.submitSubmission(student(), 'r1').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentSubmission.update).not.toHaveBeenCalled()
  })

  it('submitSubmission: все обязательные заполнены → SUBMITTED + событие SUBMIT', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst
      .mockResolvedValueOnce({
        id: 'r1',
        items: [{ id: 'req-required' }],
        submissions: [{ id: 's1', items: [{ requestItemId: 'req-required' }] }],
      })
      .mockResolvedValue({
        id: 'r1',
        title: 't',
        description: null,
        dueAt: null,
        status: 'OPEN',
        createdAt: new Date(),
        items: [],
        submissions: [],
      })
    await service.submitSubmission(student(), 'r1')
    expect(prisma.documentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SUBMIT', requestId: 'r1' }),
      }),
    )
  })
})
