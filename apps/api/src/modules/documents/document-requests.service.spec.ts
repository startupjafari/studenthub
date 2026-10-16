import { Role } from '@studenthub/shared-types'
import { DocumentRequestsService, acceptsSubmissions } from './document-requests.service'
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentSubmissionItem: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    faculty: { findFirst: jest.fn().mockResolvedValue({ id: 'fac-1' }) },
    group: { findFirst: jest.fn() },
    course: { findMany: jest.fn().mockResolvedValue([]) },
    // Пачка операций или интерактивная транзакция (колбэк получает тот же мок как tx).
    $transaction: jest.fn((arg: unknown): Promise<unknown> =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    ),
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
    prisma.group.findFirst.mockResolvedValue({ facultyId: 'fac-2' })
    prisma.course.findMany.mockResolvedValue([{ groupId: 'grp-7' }])
    await service.createRequest(staff(Role.TEACHER), {
      title: 'Дипломы',
      items: [{ documentType: 'DIPLOMA', title: 'Диплом' }], // ACADEMIC
      targets: [{ targetType: 'GROUP', targetId: 'grp-7' }],
    })
    expect(prisma.documentRequest.create).toHaveBeenCalled()
  })

  it('адресаты вне области автора → WRONG_SCOPE, запрос не создаётся', async () => {
    const cases: [
      Role,
      { targetType: 'UNIVERSITY' | 'FACULTY' | 'GROUP' | 'USER'; targetId?: string },
    ][] = [
      // Весь вуз — только модератору вуза.
      [Role.DEAN, { targetType: 'UNIVERSITY' }],
      [Role.TEACHER, { targetType: 'UNIVERSITY' }],
      // Декан — только свой факультет.
      [Role.DEAN, { targetType: 'FACULTY', targetId: 'fac-2' }],
      [Role.TEACHER, { targetType: 'FACULTY', targetId: 'fac-1' }],
      // Группа чужого факультета / группа, где преподаватель не ведёт.
      [Role.DEAN, { targetType: 'GROUP', targetId: 'grp-x' }],
      [Role.TEACHER, { targetType: 'GROUP', targetId: 'grp-x' }],
      // Студент чужого факультета.
      [Role.DEAN, { targetType: 'USER', targetId: 'stu-x' }],
    ]
    for (const [role, target] of cases) {
      const { service, prisma } = setup()
      prisma.group.findFirst.mockResolvedValue({ facultyId: 'fac-2' })
      prisma.user.findFirst.mockResolvedValue({ facultyId: 'fac-2', groupId: 'grp-x' })
      const err = await service
        .createRequest(staff(role), {
          title: 'x',
          items: [{ documentType: 'DIPLOMA', title: 'Диплом' }],
          targets: [target],
        })
        .catch((e) => e)
      expect([role, target, err.code]).toEqual([role, target, 'WRONG_SCOPE'])
      expect(prisma.documentRequest.create).not.toHaveBeenCalled()
    }
  })

  it('декан адресует свой факультет и его группу → успех', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    prisma.group.findFirst.mockResolvedValue({ facultyId: 'fac-1' })
    await service.createRequest(staff(Role.DEAN), {
      title: 'Комплект',
      items: [OK_ITEM],
      targets: [
        { targetType: 'FACULTY', targetId: 'fac-1' },
        { targetType: 'GROUP', targetId: 'grp-1' },
      ],
    })
    expect(prisma.documentRequest.create).toHaveBeenCalled()
  })

  it('успех: создаёт запрос, UNIVERSITY-адресат → targetId=null, событие REQUEST_CREATE', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' }) // findAuthoredOrThrow
    await service.createRequest(staff(Role.UNIVERSITY_MODERATOR), {
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

// Комплект для проверки (ответ getSubmissionForStaff после записи).
const STAFF_VIEW = {
  id: 's1',
  status: 'SUBMITTED',
  submittedAt: null,
  reviewedAt: null,
  request: { id: 'r1', title: 't' },
  student: { id: 'stu-1', firstName: 'И', lastName: 'И' },
  items: [],
}

// Комплект для finalize: статус + вердикты позиций.
function toFinalize(status: string, items: { status: string }[]) {
  return {
    id: 's1',
    status,
    requestId: 'r1',
    studentId: 'stu-1',
    request: { title: 'Комплект' },
    items,
  }
}

describe('DocumentRequestsService — проверка (15.16)', () => {
  it('reviewItem REJECTED: пишет причину + событие REJECT', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue({
      id: 'si1',
      submission: { id: 's1', requestId: 'r1', status: 'SUBMITTED' },
    })
    prisma.documentSubmission.findFirst.mockResolvedValue(STAFF_VIEW)
    await service.reviewItem(staff(), 'si1', { status: 'REJECTED', rejectionReason: 'нечитаемо' })
    expect(prisma.documentSubmissionItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'si1', submission: { status: { in: ['SUBMITTED', 'PARTIAL'] } } },
        data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'нечитаемо' }),
      }),
    )
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REJECT' }) }),
    )
  })

  it('reviewItem: черновик и завершённая проверка → CONFLICT, вердикт не пишется', async () => {
    for (const status of ['DRAFT', 'ACCEPTED', 'REJECTED']) {
      const { service, prisma } = setup()
      prisma.documentSubmissionItem.findFirst.mockResolvedValue({
        id: 'si1',
        submission: { id: 's1', requestId: 'r1', status },
      })
      const err = await service.reviewItem(staff(), 'si1', { status: 'ACCEPTED' }).catch((e) => e)
      expect([status, err.code]).toEqual([status, 'CONFLICT'])
      expect(prisma.documentSubmissionItem.updateMany).not.toHaveBeenCalled()
      expect(prisma.documentEvent.create).not.toHaveBeenCalled()
    }
  })

  it('reviewItem: студент вернул комплект в черновик между чтением и записью → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue({
      id: 'si1',
      submission: { id: 's1', requestId: 'r1', status: 'SUBMITTED' },
    })
    prisma.documentSubmissionItem.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.reviewItem(staff(), 'si1', { status: 'ACCEPTED' }).catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  it('finalize: любая REJECTED-позиция → комплект REJECTED + уведомление студенту', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(
        toFinalize('SUBMITTED', [{ status: 'ACCEPTED' }, { status: 'REJECTED' }]),
      )
      .mockResolvedValue({ ...STAFF_VIEW, status: 'REJECTED' })
    await service.finalizeSubmission(staff(), 's1')
    expect(prisma.documentSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', status: { in: ['SUBMITTED', 'PARTIAL'] } },
        data: expect.objectContaining({ status: 'REJECTED' }),
      }),
    )
    const [, jobName, payload] = queue.enqueue.mock.calls[0]
    expect(jobName).toBe('document-result')
    expect(payload.recipientIds).toEqual(['stu-1'])
    expect(payload.dedupeKey).toBe('doc-result:s1:REJECTED')
  })

  it('finalize: все ACCEPTED → комплект ACCEPTED', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(
        toFinalize('SUBMITTED', [{ status: 'ACCEPTED' }, { status: 'ACCEPTED' }]),
      )
      .mockResolvedValue({ ...STAFF_VIEW, status: 'ACCEPTED' })
    await service.finalizeSubmission(staff(), 's1')
    expect(prisma.documentSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    )
  })

  it('finalize: черновик студента нельзя «принять» → CONFLICT, без уведомления', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst.mockResolvedValue(
      toFinalize('DRAFT', [{ status: 'ACCEPTED' }]),
    )
    const err = await service.finalizeSubmission(staff(), 's1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.documentSubmission.updateMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('finalize: комплект изменился до записи итога → CONFLICT, без уведомления', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst.mockResolvedValue(
      toFinalize('SUBMITTED', [{ status: 'ACCEPTED' }]),
    )
    prisma.documentSubmission.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.finalizeSubmission(staff(), 's1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  it('getSubmissionFileUrl: не сотрудник → FORBIDDEN', async () => {
    const { service, documents } = setup()
    const err = await service.getSubmissionFileUrl(student(), 'si1', 'f1').catch((e) => e)
    expect(err.code).toBe('FORBIDDEN')
    expect(documents.presign).not.toHaveBeenCalled()
  })
})

// Запрос для сохранения ответа: две позиции, свой комплект в заданном статусе.
function forSave(over: Record<string, unknown> = {}, submission: unknown = null) {
  return {
    id: 'r1',
    status: 'OPEN',
    dueAt: null,
    items: [{ id: 'it1' }, { id: 'it2' }],
    submissions: submission ? [submission] : [],
    ...over,
  }
}

// Запрос для отправки: одна обязательная позиция, свой комплект в заданном статусе.
function forSubmit(status: string, over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    status: 'OPEN',
    dueAt: null,
    items: [{ id: 'req-required' }],
    submissions: [{ id: 's1', status }],
    ...over,
  }
}

const DAY = 24 * 60 * 60 * 1000

describe('DocumentRequestsService — ответ студента (15.15)', () => {
  it('saveSubmission: чужой/несуществующий документ → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSave())
    prisma.document.count.mockResolvedValue(0) // документ не принадлежит студенту
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'doc-x' }] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
  })

  it('saveSubmission: отправленный или принятый комплект не меняется → CONFLICT', async () => {
    for (const status of ['SUBMITTED', 'ACCEPTED']) {
      const { service, prisma } = setup()
      prisma.documentRequest.findFirst.mockResolvedValue(
        forSave({}, { id: 's1', status, items: [{ requestItemId: 'it1', documentId: 'doc-1' }] }),
      )
      prisma.document.count.mockResolvedValue(1)
      const err = await service
        .saveSubmission(student(), 'r1', {
          items: [{ requestItemId: 'it1', documentId: 'doc-2' }],
        })
        .catch((e) => e)
      expect([status, err.code]).toEqual([status, 'CONFLICT'])
      expect(prisma.documentSubmissionItem.upsert).not.toHaveBeenCalled()
      expect(prisma.documentSubmission.updateMany).not.toHaveBeenCalled()
    }
  })

  it('saveSubmission: замена в отклонённом комплекте возвращает его в черновик, нетронутые позиции не сбрасываются', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(
      forSave(
        {},
        {
          id: 's1',
          status: 'REJECTED',
          items: [
            { requestItemId: 'it1', documentId: 'doc-1' },
            { requestItemId: 'it2', documentId: 'doc-bad' },
          ],
        },
      ),
    )
    prisma.document.count.mockResolvedValue(2)
    await service.saveSubmission(student(), 'r1', {
      items: [
        { requestItemId: 'it1', documentId: 'doc-1' }, // без изменений
        { requestItemId: 'it2', documentId: 'doc-new' }, // замена отклонённого
      ],
    })
    expect(prisma.documentSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: { in: ['DRAFT', 'REJECTED', 'PARTIAL'] } },
      data: { status: 'DRAFT' },
    })
    expect(prisma.documentSubmissionItem.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.documentSubmissionItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ requestItemId: 'it2', documentId: 'doc-new' }),
        update: expect.objectContaining({ documentId: 'doc-new', status: 'PENDING' }),
      }),
    )
  })

  it('saveSubmission: комплект отправили параллельно → CONFLICT, позиции не пишутся', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(
      forSave({}, { id: 's1', status: 'DRAFT', items: [] }),
    )
    prisma.document.count.mockResolvedValue(1)
    prisma.documentSubmission.updateMany.mockResolvedValue({ count: 0 })
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'doc-1' }] })
      .catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.documentSubmissionItem.upsert).not.toHaveBeenCalled()
  })

  it('saveSubmission: закрытый запрос и истёкший срок → CONFLICT', async () => {
    const cases = [{ status: 'CLOSED' }, { dueAt: new Date(Date.now() - 3 * DAY) }]
    for (const over of cases) {
      const { service, prisma } = setup()
      prisma.documentRequest.findFirst.mockResolvedValue(forSave(over))
      const err = await service
        .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: null }] })
        .catch((e) => e)
      expect(err.code).toBe('CONFLICT')
      expect(prisma.documentSubmission.upsert).not.toHaveBeenCalled()
    }
  })

  it('submitSubmission: не заполнена обязательная позиция → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSubmit('DRAFT'))
    prisma.documentSubmissionItem.findMany.mockResolvedValue([]) // ничего не привязано
    const err = await service.submitSubmission(student(), 'r1').catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    // Транзакция откатывается: вердикты не сбрасываются, события SUBMIT нет.
    expect(prisma.documentSubmissionItem.updateMany).not.toHaveBeenCalled()
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  it('submitSubmission: все обязательные заполнены → SUBMITTED + событие SUBMIT', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst
      .mockResolvedValueOnce(forSubmit('REJECTED'))
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
    prisma.documentSubmissionItem.findMany.mockResolvedValue([{ requestItemId: 'req-required' }])
    await service.submitSubmission(student(), 'r1')
    expect(prisma.documentSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', status: { in: ['DRAFT', 'REJECTED', 'PARTIAL'] } },
        data: expect.objectContaining({ status: 'SUBMITTED' }),
      }),
    )
    expect(prisma.documentSubmissionItem.updateMany).toHaveBeenCalledWith({
      where: { submissionId: 's1' },
      data: { status: 'PENDING', rejectionReason: null },
    })
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'SUBMIT', requestId: 'r1' }),
      }),
    )
  })

  it('submitSubmission: принятый или уже отправленный комплект → CONFLICT, вердикты не сбрасываются', async () => {
    for (const status of ['ACCEPTED', 'SUBMITTED']) {
      const { service, prisma } = setup()
      prisma.documentRequest.findFirst.mockResolvedValue(forSubmit(status))
      const err = await service.submitSubmission(student(), 'r1').catch((e) => e)
      expect([status, err.code]).toEqual([status, 'CONFLICT'])
      expect(prisma.documentSubmission.updateMany).not.toHaveBeenCalled()
      expect(prisma.documentSubmissionItem.updateMany).not.toHaveBeenCalled()
    }
  })

  it('submitSubmission: двойная отправка (условный UPDATE не прошёл) → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSubmit('DRAFT'))
    prisma.documentSubmission.updateMany.mockResolvedValue({ count: 0 })
    const err = await service.submitSubmission(student(), 'r1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.documentSubmissionItem.updateMany).not.toHaveBeenCalled()
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  it('submitSubmission: истёкший срок → CONFLICT', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(
      forSubmit('DRAFT', { dueAt: new Date(Date.now() - 3 * DAY) }),
    )
    const err = await service.submitSubmission(student(), 'r1').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(prisma.documentSubmission.updateMany).not.toHaveBeenCalled()
  })
})

describe('acceptsSubmissions — срок сдачи', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')

  it('срок датой без времени действует весь этот день', () => {
    const dueToday = new Date('2026-10-20T00:00:00.000Z')
    expect(acceptsSubmissions({ status: 'OPEN', dueAt: dueToday }, now)).toBe(true)
    const dueYesterday = new Date('2026-10-19T00:00:00.000Z')
    expect(acceptsSubmissions({ status: 'OPEN', dueAt: dueYesterday }, now)).toBe(false)
  })

  it('срок с явным временем действует до этой минуты', () => {
    expect(
      acceptsSubmissions({ status: 'OPEN', dueAt: new Date('2026-10-20T11:59:00.000Z') }, now),
    ).toBe(false)
    expect(
      acceptsSubmissions({ status: 'OPEN', dueAt: new Date('2026-10-20T18:00:00.000Z') }, now),
    ).toBe(true)
  })

  it('закрытый запрос не принимает ответы, без срока — принимает', () => {
    expect(acceptsSubmissions({ status: 'CLOSED', dueAt: null }, now)).toBe(false)
    expect(acceptsSubmissions({ status: 'OPEN', dueAt: null }, now)).toBe(true)
  })
})
