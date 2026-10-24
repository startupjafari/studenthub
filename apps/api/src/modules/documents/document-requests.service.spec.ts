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
        createdBy: { id: 'staff-1', firstName: 'Дана', lastName: 'Ахметова' },
        items: [],
        targets: [],
        submissions: [],
        _count: { submissions: 0 },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentSubmission: {
      findFirst: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ id: 's1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
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
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    documentEvent: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    file: { findFirst: jest.fn() },
    documentType: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Асем', lastName: 'Абишева' }),
    },
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
  const documents = {
    presign: jest.fn().mockResolvedValue('https://minio/signed'),
    syncReviewStatus: jest.fn().mockResolvedValue(undefined),
  }
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

// Документы студента, найденные проверкой владения в saveSubmission.
// Тип — тот же, что у позиций forSave: сверка типа с позицией проходит.
function owned(...ids: string[]) {
  return ids.map((id) => ({
    id,
    type: 'ID_CARD',
    status: 'UPLOADED',
    issuedByUniversity: false,
    _count: { files: 1 },
  }))
}

const OK_ITEM = { documentType: 'ID_CARD', title: 'Удостоверение', required: true }

// Позиция комплекта для выдачи файла проверяющему: документ типа `type` категории `category`
// в позиции, требующей `itemType` (по умолчанию — тот же тип).
function fileItem(type: string, category: string, itemType = type) {
  return {
    documentId: 'd1',
    submission: { requestId: 'r1' },
    requestItem: { documentType: itemType },
    document: { type, category },
  }
}

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

  it('срок в прошлом → BAD_REQUEST, запрос не создаётся и не рассылается', async () => {
    const { service, prisma, queue } = setup()
    const err = await service
      .createRequest(staff(Role.UNIVERSITY_MODERATOR), {
        title: 'Комплект',
        items: [OK_ITEM],
        targets: [{ targetType: 'UNIVERSITY' }],
        dueAt: new Date('2020-01-01T00:00:00Z'),
      })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentRequest.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
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
function toFinalize(status: string, items: { status: string }[], requestStatus = 'OPEN') {
  return {
    id: 's1',
    status,
    requestId: 'r1',
    studentId: 'stu-1',
    request: { title: 'Комплект', status: requestStatus, dueAt: null },
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
    expect(payload.dedupeKey).toMatch(/^doc-result:s1:\d+$/)
  })

  it('finalize: повторное отклонение того же комплекта — новый ключ уведомления', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(toFinalize('SUBMITTED', [{ status: 'REJECTED' }]))
      .mockResolvedValueOnce({ ...STAFF_VIEW, status: 'REJECTED' })
      .mockResolvedValueOnce(toFinalize('SUBMITTED', [{ status: 'REJECTED' }]))
      .mockResolvedValue({ ...STAFF_VIEW, status: 'REJECTED' })
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T09:00:00Z'))
    try {
      await service.finalizeSubmission(staff(), 's1')
      jest.setSystemTime(new Date('2026-10-02T09:00:00Z'))
      await service.finalizeSubmission(staff(), 's1')
    } finally {
      jest.useRealTimers()
    }
    const [first, second] = queue.enqueue.mock.calls.map((c) => c[2].dedupeKey)
    expect(first).not.toBe(second)
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

  // D-F21: студент удалил документ, а проверяющий по запросу продолжал его открывать.
  it('getSubmissionFileUrl: документ удалён владельцем → NOT_FOUND, ссылки и журнала нет', async () => {
    const { service, prisma, documents } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue(fileItem('PASSPORT', 'PERSONAL'))
    prisma.file.findFirst.mockResolvedValue(null)
    const err = await service.getSubmissionFileUrl(staff(), 'si1', 'f1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.file.findFirst.mock.calls[0][0].where).toEqual({
      id: 'f1',
      documentId: 'd1',
      document: { is: { deletedAt: null } },
    })
    expect(documents.presign).not.toHaveBeenCalled()
    expect(prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  // Черновик студент ещё собирает: ни состав, ни файлы проверяющему до отправки не видны.
  it('черновик комплекта проверяющему не открывается — ни карточка, ни файлы', async () => {
    const { service, prisma, documents } = setup()
    prisma.documentSubmission.findFirst.mockResolvedValue(null)
    const err = await service.getSubmissionForStaff(staff(), 's1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.documentSubmission.findFirst.mock.calls[0][0].where).toMatchObject({
      status: { not: 'DRAFT' },
    })
    prisma.documentSubmissionItem.findFirst.mockResolvedValue(null)
    const fileErr = await service.getSubmissionFileUrl(staff(), 'si1', 'f1').catch((e) => e)
    expect(fileErr.code).toBe('NOT_FOUND')
    expect(prisma.documentSubmissionItem.findFirst.mock.calls[0][0].where.submission).toMatchObject(
      { status: { not: 'DRAFT' } },
    )
    expect(documents.presign).not.toHaveBeenCalled()
  })

  it('getSubmissionForStaff: удалённый владельцем документ показан неприложенным', async () => {
    const { service, prisma } = setup()
    const doc = (id: string, deletedAt: Date | null) => ({
      id,
      title: 'Паспорт',
      type: 'PASSPORT',
      category: 'PERSONAL',
      numberLast4: '4821',
      deletedAt,
      files: [{ id: `${id}-f`, mime: 'application/pdf' }],
      _count: { files: 1 },
    })
    const item = (id: string, order: number, document: unknown) => ({
      id,
      status: 'PENDING',
      rejectionReason: null,
      requestItem: { id: `ri-${id}`, title: 't', documentType: 'PASSPORT', required: true, order },
      document,
    })
    prisma.documentSubmission.findFirst.mockResolvedValue({
      ...STAFF_VIEW,
      items: [item('live', 0, doc('d1', null)), item('gone', 1, doc('d2', new Date()))],
    })
    const view = await service.getSubmissionForStaff(staff(), 's1')
    expect(view.items[0]!.document).toMatchObject({ id: 'd1', numberMasked: '******4821' })
    expect(view.items[1]!.document).toBeNull()
  })
})

describe('DocumentRequestsService — что открывается проверяющему (§15.2)', () => {
  it('преподавателю учебный документ своей позиции открывается, с записью VIEW', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue(fileItem('DIPLOMA', 'ACADEMIC'))
    prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
    const url = await service.getSubmissionFileUrl(staff(Role.TEACHER), 'si1', 'f1')
    expect(url).toBe('https://minio/signed')
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'VIEW' }) }),
    )
  })

  it('преподавателю удостоверение и мед. справка не открываются → NOT_FOUND', async () => {
    for (const [type, category] of [
      ['ID_CARD', 'PERSONAL'],
      ['MEDICAL', 'CERTIFICATE'],
    ] as const) {
      const { service, prisma, documents } = setup()
      prisma.documentSubmissionItem.findFirst.mockResolvedValue(fileItem(type, category))
      prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
      const err = await service
        .getSubmissionFileUrl(staff(Role.TEACHER), 'si1', 'f1')
        .catch((e) => e)
      expect([type, err.code]).toEqual([type, 'NOT_FOUND'])
      expect(documents.presign).not.toHaveBeenCalled()
      expect(prisma.documentEvent.create).not.toHaveBeenCalled()
    }
  })

  it('деканату и модератору открываются документы любой категории своей позиции', async () => {
    for (const role of [Role.DEAN, Role.UNIVERSITY_MODERATOR]) {
      const { service, prisma, documents } = setup()
      prisma.documentSubmissionItem.findFirst.mockResolvedValue(fileItem('PASSPORT', 'PERSONAL'))
      prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
      await service.getSubmissionFileUrl(staff(role), 'si1', 'f1')
      expect(documents.presign).toHaveBeenCalledWith('f1')
    }
  })

  it('документ не того типа, что требует позиция (привязка до сверки), не открывается никому', async () => {
    for (const role of [Role.DEAN, Role.TEACHER]) {
      const { service, prisma, documents } = setup()
      prisma.documentSubmissionItem.findFirst.mockResolvedValue(
        fileItem('PASSPORT', 'PERSONAL', 'DIPLOMA'),
      )
      prisma.file.findFirst.mockResolvedValue({ id: 'f1' })
      const err = await service.getSubmissionFileUrl(staff(role), 'si1', 'f1').catch((e) => e)
      expect(err.code).toBe('NOT_FOUND')
      expect(documents.presign).not.toHaveBeenCalled()
    }
  })

  it('карточка комплекта у преподавателя: неположенный документ показан неприложенным', async () => {
    const { service, prisma } = setup()
    const item = (id: string, documentType: string, type: string, category: string) => ({
      id,
      status: 'PENDING',
      rejectionReason: null,
      requestItem: { id: `ri-${id}`, title: 't', documentType, required: true, order: 0 },
      document: {
        id: `doc-${id}`,
        title: 'Документ',
        type,
        category,
        numberLast4: '4821',
        deletedAt: null,
        files: [{ id: `${id}-f`, mime: 'application/pdf' }],
        _count: { files: 1 },
      },
    })
    prisma.documentSubmission.findFirst.mockResolvedValue({
      ...STAFF_VIEW,
      items: [
        item('ok', 'DIPLOMA', 'DIPLOMA', 'ACADEMIC'),
        item('swap', 'DIPLOMA', 'PASSPORT', 'PERSONAL'),
      ],
    })
    const view = await service.getSubmissionForStaff(staff(Role.TEACHER), 's1')
    expect(view.items.find((i) => i.id === 'ok')!.document).toMatchObject({ id: 'doc-ok' })
    expect(view.items.find((i) => i.id === 'swap')!.document).toBeNull()
  })
})

// Запрос для сохранения ответа: две позиции, свой комплект в заданном статусе.
function forSave(over: Record<string, unknown> = {}, submission: unknown = null) {
  return {
    id: 'r1',
    status: 'OPEN',
    dueAt: null,
    items: [
      { id: 'it1', documentType: 'ID_CARD' },
      { id: 'it2', documentType: 'ID_CARD' },
    ],
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
    prisma.document.findMany.mockResolvedValue(owned()) // документ не принадлежит студенту
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
      prisma.document.findMany.mockResolvedValue(owned('doc-1'))
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
    prisma.document.findMany.mockResolvedValue(owned('doc-1', 'doc-new'))
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
    prisma.document.findMany.mockResolvedValue(owned('doc-1'))
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

  it('submitSubmission: удалённый документ обязательную позицию не заполняет', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSubmit('DRAFT'))
    await service.submitSubmission(student(), 'r1').catch((e) => e)
    expect(prisma.documentSubmissionItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ document: { is: { deletedAt: null } } }),
      }),
    )
  })

  it('getForStudent: удалённый документ в позиции отдаётся как неприложенный', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({
      id: 'r1',
      title: 't',
      description: null,
      dueAt: null,
      status: 'OPEN',
      createdAt: new Date(),
      items: [],
      submissions: [
        {
          id: 's1',
          status: 'DRAFT',
          submittedAt: null,
          items: [
            {
              requestItemId: 'it1',
              status: 'PENDING',
              rejectionReason: null,
              document: { id: 'doc-1', title: 'Паспорт', type: 'ID_CARD', deletedAt: new Date() },
            },
          ],
        },
      ],
    })
    const res = await service.getForStudent(student(), 'r1')
    expect(res.submission?.items[0]?.document).toBeNull()
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
    // Повторная отправка возвращённого комплекта: принятые позиции сохраняют вердикт.
    expect(prisma.documentSubmissionItem.updateMany).toHaveBeenCalledWith({
      where: { submissionId: 's1', status: { not: 'ACCEPTED' } },
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

describe('DocumentRequestsService — область сотрудника и сопровождение (D-F25)', () => {
  it('декан видит свои запросы и запросы деканата факультета, но не преподавательские', async () => {
    const { service, prisma } = setup()
    await service.listAuthored(staff(Role.DEAN))
    expect(prisma.documentRequest.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-1',
      OR: [
        { createdById: 'staff-1' },
        { createdBy: { facultyId: 'fac-1', role: { not: Role.TEACHER } } },
      ],
    })
  })

  it('модератор вуза видит весь вуз, преподаватель — только свои запросы', async () => {
    const mod = setup()
    await mod.service.listAuthored(staff(Role.UNIVERSITY_MODERATOR))
    expect(mod.prisma.documentRequest.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-1',
    })
    const teacher = setup()
    await teacher.service.listAuthored(staff(Role.TEACHER))
    expect(teacher.prisma.documentRequest.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-1',
      createdById: 'staff-1',
    })
  })

  it('список: отправленные считаются агрегатом, чужой запрос помечен автором', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findMany.mockResolvedValue([
      {
        id: 'r1',
        title: 'Комплект',
        dueAt: null,
        status: 'OPEN',
        createdAt: new Date(),
        createdBy: { id: 'dean-old', firstName: 'Ерлан', lastName: 'Серикович' },
        _count: { items: 2, targets: 1, submissions: 5 },
      },
    ])
    prisma.documentSubmission.groupBy.mockResolvedValue([{ requestId: 'r1', _count: { _all: 3 } }])
    const [row] = await service.listAuthored(staff(Role.DEAN))
    expect(prisma.documentSubmission.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['requestId'],
        where: { requestId: { in: ['r1'] }, status: { not: 'DRAFT' } },
      }),
    )
    expect(row).toMatchObject({
      submissionCount: 5,
      submittedCount: 3,
      mine: false,
      authorName: 'Серикович Ерлан',
    })
  })

  it('проверка комплекта ищется в области сотрудника, а не только по автору', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmission.findFirst.mockResolvedValue(STAFF_VIEW)
    await service.getSubmissionForStaff(staff(Role.UNIVERSITY_MODERATOR), 's1')
    expect(prisma.documentSubmission.findFirst.mock.calls[0][0].where).toEqual({
      id: 's1',
      status: { not: 'DRAFT' },
      request: { universityId: 'uni-1' },
    })
  })

  it('карточка запроса: первые 200 комплектов и общее число', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    prisma.documentRequest.findUnique.mockResolvedValue({
      id: 'r1',
      title: 'Комплект',
      description: null,
      dueAt: null,
      status: 'OPEN',
      createdAt: new Date(),
      createdBy: { id: 'staff-1', firstName: 'Дана', lastName: 'Ахметова' },
      items: [],
      targets: [],
      submissions: [],
      _count: { submissions: 1200 },
    })
    const res = await service.getRequestForStaff(staff(), 'r1')
    const select = prisma.documentRequest.findUnique.mock.calls[0][0].select
    expect(select.submissions.take).toBe(200)
    expect(res).toMatchObject({ mine: true, submissionCount: 1200 })
  })

  it('комплекты постранично: limit + 1 строк → hasNext и курсор на последний', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    const rows = ['s1', 's2', 's3'].map((id) => ({
      id,
      status: 'SUBMITTED',
      submittedAt: null,
      reviewedAt: null,
      student: { id: `u-${id}`, firstName: 'И', lastName: 'И' },
      _count: { items: 1 },
    }))
    prisma.documentSubmission.findMany.mockResolvedValue(rows)
    const page = await service.listSubmissionsForStaff(staff(), 'r1', { limit: 2, cursor: 's0' })
    expect(prisma.documentSubmission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestId: 'r1' }, take: 3, cursor: { id: 's0' } }),
    )
    expect(page.items.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(page.meta).toMatchObject({ cursor: 's2', hasNext: true })
  })

  it('закрытие запроса: условный UPDATE и событие; повторное — без события', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    await service.closeRequest(staff(), 'r1')
    expect(prisma.documentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'OPEN' },
      data: { status: 'CLOSED' },
    })
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'REQUEST_CLOSE' }) }),
    )

    const again = setup()
    again.prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    again.prisma.documentRequest.updateMany.mockResolvedValue({ count: 0 })
    await again.service.closeRequest(staff(), 'r1')
    expect(again.prisma.documentEvent.create).not.toHaveBeenCalled()
  })

  it('закрыть чужой запрос вне области нельзя → NOT_FOUND', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(null)
    const err = await service.closeRequest(staff(Role.TEACHER), 'r1').catch((e) => e)
    expect(err.code).toBe('NOT_FOUND')
    expect(prisma.documentRequest.updateMany).not.toHaveBeenCalled()
  })

  it('крон закрывает только запросы с прошедшим сроком: срок-дата длится весь день', async () => {
    const { service, prisma } = setup()
    const now = new Date('2026-10-20T12:00:00.000Z')
    prisma.documentRequest.findMany.mockResolvedValue([
      { id: 'r-old', status: 'OPEN', dueAt: new Date('2026-10-19T00:00:00.000Z') },
      { id: 'r-today', status: 'OPEN', dueAt: new Date('2026-10-20T00:00:00.000Z') },
      { id: 'r-hour', status: 'OPEN', dueAt: new Date('2026-10-20T09:00:00.000Z') },
    ])
    prisma.documentRequest.updateMany.mockResolvedValue({ count: 2 })
    expect(await service.closeOverdue(now)).toBe(2)
    expect(prisma.documentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r-old', 'r-hour'] }, status: 'OPEN' },
      data: { status: 'CLOSED' },
    })
  })

  it('уведомление о новом запросе уходит пачками без потолка', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue({ id: 'r1' })
    prisma.documentRequestTarget.findMany.mockResolvedValue([
      { targetType: 'UNIVERSITY', targetId: null },
    ])
    const ids = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `u-${String(from + i).padStart(5, '0')}` }))
    prisma.user.findMany.mockResolvedValueOnce(ids(0, 1000)).mockResolvedValueOnce(ids(1000, 1))
    await service.createRequest(staff(Role.UNIVERSITY_MODERATOR), {
      title: 'Комплект',
      items: [OK_ITEM],
      targets: [{ targetType: 'UNIVERSITY' }],
    })
    expect(queue.enqueue).toHaveBeenCalledTimes(2)
    const [first, second] = queue.enqueue.mock.calls
    expect(first[2].recipientIds).toHaveLength(1000)
    expect(second[2].recipientIds).toEqual(['u-01000'])
    expect(first[2].dedupeKey).toBe(second[2].dedupeKey)
    expect(first[3].jobId).not.toBe(second[3].jobId)
    // Вторая пачка читается после последнего id первой.
    expect(JSON.stringify(prisma.user.findMany.mock.calls[1][0].where)).toContain('u-00999')
  })

  it('сдача комплекта уведомляет автора запроса: свёрнуто по запросу, без письма', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentRequest.findFirst
      .mockResolvedValueOnce(forSubmit('DRAFT', { title: 'Комплект', createdById: 'dean-1' }))
      .mockResolvedValue({
        ...forSubmit('SUBMITTED'),
        description: null,
        createdAt: new Date(),
        submissions: [],
      })
    prisma.documentSubmissionItem.findMany.mockResolvedValue([{ requestItemId: 'req-required' }])
    await service.submitSubmission(student(), 'r1')
    const [, , job] = queue.enqueue.mock.calls[0]
    expect(job).toMatchObject({
      recipientIds: ['dean-1'],
      titleKey: 'documents.submitted.title',
      params: { name: 'Абишева Асем', title: 'Комплект' },
      collapseKey: 'doc-submitted:r1',
      emailFallback: false,
    })
  })

  it('документ не того типа, что требует позиция → BAD_REQUEST, комплект не пишется', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(
      forSave({ items: [{ id: 'it1', documentType: 'DIPLOMA' }] }),
    )
    prisma.document.findMany.mockResolvedValue([
      { id: 'pass-1', type: 'PASSPORT', status: 'UPLOADED', issuedByUniversity: false },
    ])
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'pass-1' }] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentSubmission.upsert).not.toHaveBeenCalled()
    expect(prisma.documentSubmissionItem.upsert).not.toHaveBeenCalled()
  })

  it('прежняя привязка не того типа не мешает сохранить другие позиции', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(
      forSave(
        {
          items: [
            { id: 'it1', documentType: 'DIPLOMA' },
            { id: 'it2', documentType: 'ID_CARD' },
          ],
        },
        {
          id: 's1',
          status: 'DRAFT',
          items: [{ requestItemId: 'it1', documentId: 'pass-old' }],
        },
      ),
    )
    prisma.document.findMany.mockResolvedValue([
      { id: 'pass-old', type: 'PASSPORT', status: 'UPLOADED', issuedByUniversity: false },
      ...owned('id-1'),
    ])
    await service.saveSubmission(student(), 'r1', {
      items: [
        { requestItemId: 'it1', documentId: 'pass-old' },
        { requestItemId: 'it2', documentId: 'id-1' },
      ],
    })
    expect(prisma.documentSubmissionItem.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.documentSubmissionItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ requestItemId: 'it2', documentId: 'id-1' }),
      }),
    )
  })

  it('документ без файлов к запросу не приложить → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSave())
    prisma.document.findMany.mockResolvedValue([{ ...owned('empty-1')[0], _count: { files: 0 } }])
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'empty-1' }] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentSubmission.upsert).not.toHaveBeenCalled()
  })

  it('отозванную вузом справку к запросу не приложить → BAD_REQUEST', async () => {
    const { service, prisma } = setup()
    prisma.documentRequest.findFirst.mockResolvedValue(forSave())
    prisma.document.findMany.mockResolvedValue([
      { id: 'cert-1', status: 'REJECTED', issuedByUniversity: true },
    ])
    const err = await service
      .saveSubmission(student(), 'r1', { items: [{ requestItemId: 'it1', documentId: 'cert-1' }] })
      .catch((e) => e)
    expect(err.code).toBe('BAD_REQUEST')
    expect(prisma.documentSubmission.upsert).not.toHaveBeenCalled()
  })
})

describe('DocumentRequestsService — подтверждение сертификатов (D-F30)', () => {
  function certItem(documentType: string, doc = { category: 'CERTIFICATE', type: 'IELTS' }) {
    return {
      id: 'si1',
      documentId: 'doc-cert',
      submission: { id: 's1', requestId: 'r1', status: 'SUBMITTED' },
      requestItem: { documentType },
      document: doc,
    }
  }

  it('принятый сертификат своего типа становится VERIFIED, в журнал документа — ACCEPT', async () => {
    const { service, prisma } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue(certItem('IELTS'))
    prisma.documentSubmission.findFirst.mockResolvedValue(STAFF_VIEW)
    await service.reviewItem(staff(), 'si1', { status: 'ACCEPTED' })
    expect(prisma.documentSubmissionItem.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'si1',
      documentId: 'doc-cert',
    })
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'doc-cert',
        deletedAt: null,
        status: { in: ['UPLOADED', 'ACCEPTED', 'EXPIRING'] },
      },
      data: { status: 'VERIFIED' },
    })
    expect(prisma.documentEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ documentId: 'doc-cert', metadata: { verified: true } }),
      }),
    )
  })

  it('сертификат не своей позиции, не сертификат и отклонение — без подтверждения', async () => {
    const cases: [ReturnType<typeof certItem>, 'ACCEPTED' | 'REJECTED'][] = [
      [certItem('DIPLOMA'), 'ACCEPTED'],
      [certItem('ID_CARD', { category: 'PERSONAL', type: 'ID_CARD' }), 'ACCEPTED'],
      [certItem('IELTS'), 'REJECTED'],
    ]
    for (const [item, status] of cases) {
      const { service, prisma } = setup()
      prisma.documentSubmissionItem.findFirst.mockResolvedValue(item)
      prisma.documentSubmission.findFirst.mockResolvedValue(STAFF_VIEW)
      await service.reviewItem(staff(), 'si1', { status, rejectionReason: 'нет' })
      expect(prisma.document.updateMany).not.toHaveBeenCalled()
    }
  })
})

describe('DocumentRequestsService — прогресс группы для старосты', () => {
  function starosta(over: Partial<JwtPayload> = {}): JwtPayload {
    return {
      sub: 'st-1',
      role: Role.STAROSTA,
      universityId: 'uni-1',
      facultyId: 'fac-1',
      groupId: 'grp-1',
      ...over,
    }
  }
  const MEMBERS = [
    { id: 'st-1', firstName: 'Староста', lastName: 'Алиев' },
    { id: 'm2', firstName: 'Асем', lastName: 'Бекова' },
    { id: 'm3', firstName: 'Ерлан', lastName: 'Жумабаев' },
  ]

  function ready() {
    const ctx = setup()
    ctx.prisma.group.findFirst.mockResolvedValue({ id: 'grp-1', facultyId: 'fac-1' })
    ctx.prisma.user.findMany.mockResolvedValue(MEMBERS)
    ctx.prisma.documentRequest.findMany.mockResolvedValue([
      {
        id: 'acad',
        title: 'Учебные',
        status: 'OPEN',
        dueAt: null,
        items: [{ documentType: 'TRANSCRIPT' }],
      },
      {
        id: 'pers',
        title: 'Личные',
        status: 'OPEN',
        dueAt: null,
        items: [{ documentType: 'PASSPORT' }],
      },
    ])
    ctx.prisma.documentSubmission.findMany.mockResolvedValue([
      { requestId: 'acad', studentId: 'st-1', status: 'ACCEPTED' },
      { requestId: 'acad', studentId: 'm2', status: 'REJECTED' },
      { requestId: 'pers', studentId: 'm2', status: 'REJECTED' },
      { requestId: 'pers', studentId: 'm3', status: 'SUBMITTED' },
    ])
    return ctx
  }

  it('не староста или без группы в токене → FORBIDDEN', async () => {
    for (const actor of [student(), staff(), starosta({ groupId: null })]) {
      const { service, prisma } = setup()
      const err = await service.groupProgress(actor).catch((e) => e)
      expect(err.code).toBe('FORBIDDEN')
      expect(prisma.documentRequest.findMany).not.toHaveBeenCalled()
    }
  })

  it('группа из токена ищется только в своём вузе; чужая → WRONG_SCOPE', async () => {
    const { service, prisma } = setup()
    prisma.group.findFirst.mockResolvedValue(null)
    const err = await service.groupProgress(starosta()).catch((e) => e)
    expect(prisma.group.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grp-1', faculty: { universityId: 'uni-1' } } }),
    )
    expect(err.code).toBe('WRONG_SCOPE')
  })

  it('берёт запросы на группу, её факультет и вуз; одногруппников — только своей группы', async () => {
    const { service, prisma } = ready()
    await service.groupProgress(starosta())
    expect(prisma.documentRequest.findMany.mock.calls[0][0].where).toEqual({
      universityId: 'uni-1',
      status: 'OPEN',
      targets: {
        some: {
          OR: [
            { targetType: 'UNIVERSITY' },
            { targetType: 'FACULTY', targetId: 'fac-1' },
            { targetType: 'GROUP', targetId: 'grp-1' },
          ],
        },
      },
    })
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      groupId: 'grp-1',
      universityId: 'uni-1',
    })
  })

  it('учебный запрос — поимённо со статусом комплекта, личный — только счётчики', async () => {
    const { service } = ready()
    const [acad, pers] = await service.groupProgress(starosta())

    expect(acad).toMatchObject({
      kind: 'ACADEMIC',
      counts: { total: 3, notSubmitted: 1, submitted: 0, needsFix: 1, accepted: 1 },
      members: [
        { id: 'st-1', name: 'Алиев Староста', status: 'ACCEPTED' },
        { id: 'm2', name: 'Бекова Асем', status: 'NEEDS_FIX' },
        { id: 'm3', name: 'Жумабаев Ерлан', status: 'NOT_STARTED' },
      ],
    })
    // Отказ по личным документам не выделяется и не привязывается к человеку.
    expect(pers).toMatchObject({
      kind: 'PERSONAL',
      counts: { total: 3, notSubmitted: 2, submitted: 1, needsFix: null, accepted: 0 },
      members: null,
    })
  })

  it('в ответе нет ничего о документах — только статус комплекта', async () => {
    const { service, prisma } = ready()
    const res = await service.groupProgress(starosta())
    // Комплекты читаются без позиций и документов.
    expect(prisma.documentSubmission.findMany.mock.calls[0][0].select).toEqual({
      requestId: true,
      studentId: true,
      status: true,
    })
    const json = JSON.stringify(res)
    for (const leak of ['TRANSCRIPT', 'PASSPORT', 'documentId', 'numberMasked', 'files']) {
      expect(json).not.toContain(leak)
    }
  })
})

describe('DocumentRequestsService — статусы документов по вердикту (15.3)', () => {
  it('отправка комплекта: событие SUBMIT в истории каждого документа и пересчёт статусов', async () => {
    const { service, prisma, documents } = setup()
    prisma.documentRequest.findFirst
      .mockResolvedValueOnce(forSubmit('DRAFT', { title: 'Комплект', createdById: 'staff-1' }))
      .mockResolvedValue({ ...forSave(), title: 't', description: null, createdAt: new Date() })
    prisma.documentSubmissionItem.findMany
      .mockResolvedValueOnce([{ requestItemId: 'req-required' }]) // проверка обязательных
      .mockResolvedValueOnce([{ documentId: 'doc-1' }, { documentId: 'doc-2' }])
    await service.submitSubmission(student(), 'r1')

    expect(prisma.documentEvent.createMany).toHaveBeenCalledWith({
      data: ['doc-1', 'doc-2'].map((documentId) => ({
        actorId: 'stu-1',
        requestId: 'r1',
        documentId,
        action: 'SUBMIT',
        metadata: { submissionId: 's1' },
      })),
    })
    expect(documents.syncReviewStatus).toHaveBeenCalledWith(['doc-1', 'doc-2'])
  })

  it('вердикт по позиции: событие с documentId и причиной, статус документа пересчитан', async () => {
    const { service, prisma, documents } = setup()
    prisma.documentSubmissionItem.findFirst.mockResolvedValue({
      id: 'si1',
      documentId: 'doc-1',
      submission: { id: 's1', requestId: 'r1', status: 'SUBMITTED' },
      requestItem: { documentType: 'ID_CARD' },
      document: { category: 'PERSONAL', type: 'ID_CARD' },
    })
    prisma.documentSubmission.findFirst.mockResolvedValue(STAFF_VIEW)
    await service.reviewItem(staff(), 'si1', { status: 'REJECTED', rejectionReason: 'размыто' })

    expect(prisma.documentEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          actorId: 'staff-1',
          requestId: 'r1',
          documentId: 'doc-1',
          action: 'REJECT',
          metadata: { submissionItemId: 'si1', reason: 'размыто' },
        },
      ],
    })
    expect(documents.syncReviewStatus).toHaveBeenCalledWith(['doc-1'], {
      reviewedRequestId: 'r1',
    })
  })

  it('завершение с отклонением: REVIEW по документам и уведомление «требуется замена»', async () => {
    const { service, prisma, queue, documents } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(toFinalize('SUBMITTED', [{ status: 'REJECTED' }]))
      .mockResolvedValue({ ...STAFF_VIEW, status: 'REJECTED' })
    prisma.documentSubmissionItem.findMany.mockResolvedValueOnce([{ documentId: 'doc-1' }])
    await service.finalizeSubmission(staff(), 's1')

    expect(prisma.documentEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          documentId: 'doc-1',
          requestId: 'r1',
          action: 'REVIEW',
          metadata: { status: 'REJECTED', submissionId: 's1' },
        }),
      ],
    })
    expect(documents.syncReviewStatus).toHaveBeenCalledWith(['doc-1'], {
      reviewedRequestId: 'r1',
    })
    expect(queue.enqueue.mock.calls[0][2].titleKey).toBe('documents.replacement.title')
    expect(queue.enqueue.mock.calls[0][2].data.url).toBe('/documents?section=requests')
  })

  // Проверка после закрытия запроса: пересдать по нему нельзя, а раздел запросов его уже
  // не показывает — уведомление ведёт туда, где документ «требует замены».
  it('завершение по закрытому запросу: вердикт ставит статус, ссылка — на «Обзор»', async () => {
    const { service, prisma, queue, documents } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(toFinalize('SUBMITTED', [{ status: 'REJECTED' }], 'CLOSED'))
      .mockResolvedValue({ ...STAFF_VIEW, status: 'REJECTED' })
    prisma.documentSubmissionItem.findMany.mockResolvedValueOnce([{ documentId: 'doc-1' }])
    await service.finalizeSubmission(staff(), 's1')
    expect(documents.syncReviewStatus).toHaveBeenCalledWith(['doc-1'], {
      reviewedRequestId: 'r1',
    })
    expect(queue.enqueue.mock.calls[0][2].data.url).toBe('/documents')
  })

  it('принятый комплект — обычное уведомление о результате', async () => {
    const { service, prisma, queue } = setup()
    prisma.documentSubmission.findFirst
      .mockResolvedValueOnce(toFinalize('SUBMITTED', [{ status: 'ACCEPTED' }]))
      .mockResolvedValue({ ...STAFF_VIEW, status: 'ACCEPTED' })
    await service.finalizeSubmission(staff(), 's1')
    expect(queue.enqueue.mock.calls[0][2].titleKey).toBe('documents.result.title')
  })

  it('правка черновика: пересчёт и прежнего документа позиции, и нового', async () => {
    const { service, prisma, documents } = setup()
    prisma.documentRequest.findFirst
      .mockResolvedValueOnce(
        forSave(
          {},
          { id: 's1', status: 'REJECTED', items: [{ requestItemId: 'it1', documentId: 'old' }] },
        ),
      )
      .mockResolvedValue({ ...forSave(), title: 't', description: null, createdAt: new Date() })
    prisma.document.findMany.mockResolvedValue(owned('new'))
    prisma.documentSubmissionItem.upsert.mockResolvedValue({})
    await service.saveSubmission(student(), 'r1', {
      items: [{ requestItemId: 'it1', documentId: 'new' }],
    })
    expect(documents.syncReviewStatus).toHaveBeenCalledWith(['old', 'new'])
  })
})
