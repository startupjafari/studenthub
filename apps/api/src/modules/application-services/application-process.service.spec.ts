import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import { AppException } from '../../common/exceptions/app.exception'
import { ApplicationProcessService } from './application-process.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { QueueService } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'

// Настоящий рендер тянет @react-pdf и файл шрифта — секунды на каждый тест. Бланк
// проверяется прогоном (см. B7), здесь — порядок действий вокруг него.
jest.mock('./study-certificate-pdf', () => ({
  renderStudyCertificatePdf: jest.fn(async () => Buffer.from('%PDF-stub')),
}))

// $transaction поддерживает обе формы: колбэк (async tx => …) и массив промисов.
function makePrisma(appRow: Record<string, unknown>) {
  const application = {
    findFirst: jest.fn().mockResolvedValue(appRow),
    findUnique: jest.fn().mockResolvedValue({ pickupCode: 'SH-P-AB12CD34' }),
    update: jest.fn().mockResolvedValue({ ...appRow }),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationEvent = { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) }
  const applicationResult = {
    create: jest.fn().mockResolvedValue({}),
    // Результаты заявки: «готово» для электронной выдачи без результата не ставится.
    count: jest.fn().mockResolvedValue(1),
  }
  // Документ студента — отметка об отзыве справки.
  const document = { updateManyAndReturn: jest.fn().mockResolvedValue([{ id: 'doc-1' }]) }
  // Журнал документа — запись об отзыве справки.
  const documentEvent = { createMany: jest.fn().mockResolvedValue({ count: 1 }) }
  const tx = { application, applicationEvent, applicationResult, document, documentEvent }
  const prisma = {
    ...tx,
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
  }
  return prisma
}

const dean: JwtPayload = {
  sub: 'dean',
  role: Role.DEAN,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: null,
}

/** Учебные данные студента для бланка справки — ровно то, что отдаёт UserService. */
const academicSubject = {
  fullName: 'Оспанова Аружан',
  specialty: 'Информационные системы',
  course: 3,
  educationLevel: 'Бакалавриат',
  studyForm: 'Очная',
  fundingType: 'Грант',
  enrollmentYear: 2023,
  graduationYear: 2027,
  academicStatus: 'ACTIVE',
  studentCardNumber: 'СБ-1',
  groupName: 'ИТ-23-1',
  facultyName: 'ФИТ',
  universityName: 'Алатауский университет',
  universityCity: 'Алматы',
  timezone: 'Asia/Almaty',
}

function setup(appRow: Record<string, unknown>) {
  const prisma = makePrisma(appRow)
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) }
  const realtime = { emitEventToUser: jest.fn() }
  // Выдача документа студенту (issueToOwner) — единственное, что процесс просит у домена
  // «Документы»; в юнитах подменяем заглушкой.
  const documents = {
    issueToOwner: jest.fn().mockResolvedValue({ id: 'doc-issued' }),
    uploadFile: jest.fn().mockResolvedValue({ id: 'file-1', mime: 'application/pdf', size: 1024 }),
    isOwnedBy: jest.fn().mockResolvedValue(true),
  }
  // Справка об обучении (B7): данные студента, брендирование и журнал выгрузок — чужие
  // домены, в юните подменяются заглушками. Сам рендер PDF проверяется отдельно.
  const users = {
    academicSubject: jest.fn().mockResolvedValue(academicSubject),
    fullName: jest.fn().mockResolvedValue('Иванова Елена'),
    findAssigneeScope: jest.fn().mockResolvedValue(null),
    listApplicationAssignees: jest.fn().mockResolvedValue([]),
  }
  const branding = {
    publicUrl: 'https://studenthub.kz',
    dateTime: jest.fn().mockReturnValue('11.09.2026, 14:15 (Asia/Almaty)'),
    pdfBranding: jest.fn().mockResolvedValue({
      metadata: {},
      logo: null,
      generatedLine: '',
      footerLine: () => '',
    }),
  }
  const exportRegistry = {
    register: jest.fn().mockResolvedValue({ id: 'exp-1', shortId: 'JT9ZPNDD' }),
    registerExclusive: jest.fn().mockResolvedValue({ id: 'exp-1', shortId: 'JT9ZPNDD' }),
    revokeByDocumentNumber: jest.fn().mockResolvedValue(1),
    hasActiveDocument: jest.fn().mockResolvedValue(false),
    revokeByShortId: jest.fn().mockResolvedValue(undefined),
  }
  const service = new ApplicationProcessService(
    prisma as unknown as PrismaService,
    new ApplicationPolicy(),
    queue as unknown as QueueService,
    realtime as never,
    documents as never,
    users as never,
    branding as never,
    exportRegistry as never,
  )
  return { service, prisma, queue, realtime, documents, users, branding, exportRegistry }
}

const base = {
  id: 'a1',
  number: 'SH-1',
  studentId: 'stud',
  facultyId: 'fac',
  universityId: 'uni',
  deliveryType: 'ELECTRONIC',
  service: { nameRu: 'Справка' },
}

describe('ApplicationProcessService — state-machine + guards', () => {
  it('take из SUBMITTED → IN_REVIEW + назначение + уведомление НЕ шлётся (нет notify)', async () => {
    const { service, prisma } = setup({ ...base, status: 'SUBMITTED' })
    await service.take(dean, 'a1')
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'IN_REVIEW', assignedToId: 'dean' }),
      }),
    )
  })

  it('take из IN_PREPARATION → BAD_REQUEST (нельзя взять из этого статуса)', async () => {
    const { service } = setup({ ...base, status: 'IN_PREPARATION' })
    await expect(service.take(dean, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('startPreparation из SUBMITTED → BAD_REQUEST (недопустимый переход)', async () => {
    const { service, prisma } = setup({ ...base, status: 'SUBMITTED' })
    await expect(service.startPreparation(dean, 'a1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.application.update).not.toHaveBeenCalled()
  })

  it('reject без причины → BAD_REQUEST', async () => {
    const { service } = setup({ ...base, status: 'IN_REVIEW' })
    await expect(service.reject(dean, 'a1', '')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('markReady для PAPER/BOTH → READY_FOR_PICKUP + pickupCode; уведомляет студента', async () => {
    const { service, prisma, queue } = setup({
      ...base,
      status: 'IN_PREPARATION',
      deliveryType: 'BOTH',
    })
    await service.markReady(dean, 'a1', { pickupLocation: 'каб. 312' })
    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'READY_FOR_PICKUP',
          pickupCode: expect.stringContaining('SH-P-'),
        }),
      }),
    )
    expect(queue.enqueue).toHaveBeenCalled()
  })

  it('markReady для ELECTRONIC → READY (без pickupCode)', async () => {
    const { service, prisma } = setup({
      ...base,
      status: 'IN_PREPARATION',
      deliveryType: 'ELECTRONIC',
    })
    await service.markReady(dean, 'a1', {})
    const call = prisma.application.update.mock.calls[0][0]
    expect(call.data.status).toBe('READY')
    expect(call.data.pickupCode).toBeUndefined()
  })

  it('issue из READY_FOR_PICKUP → ISSUED; из READY → BAD_REQUEST', async () => {
    const ok = setup({ ...base, status: 'READY_FOR_PICKUP' })
    await ok.service.issue(dean, 'a1')
    expect(ok.prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ISSUED', issuedById: 'dean' }),
      }),
    )
    const bad = setup({ ...base, status: 'READY' })
    await expect(bad.service.issue(dean, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('addResult с файлом заводит документ на СТУДЕНТА и кладёт его id в результат', async () => {
    const { service, prisma, documents } = setup({ ...base, status: 'IN_PREPARATION' })
    await service.addResult(dean, 'a1', {
      type: 'ELECTRONIC_DOCUMENT',
      fileId: 'f1',
      documentType: 'STUDY_PLACE_REF',
      documentNumber: 'N-1',
    })
    expect(documents.issueToOwner).toHaveBeenCalledWith(
      dean,
      expect.objectContaining({ ownerId: 'stud', fileId: 'f1', title: 'Справка' }),
    )
    expect(prisma.applicationResult.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ documentId: 'doc-issued' }) }),
    )
  })

  it('addResult без файла документ не выдаёт', async () => {
    const { service, prisma, documents } = setup({ ...base, status: 'IN_PREPARATION' })
    await service.addResult(dean, 'a1', { type: 'INFORMATION', note: 'выдано устно' })
    expect(documents.issueToOwner).not.toHaveBeenCalled()
    expect(prisma.applicationResult.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ documentId: null }) }),
    )
  })

  it('addResult вне IN_PREPARATION → BAD_REQUEST', async () => {
    const { service } = setup({ ...base, status: 'IN_REVIEW' })
    await expect(service.addResult(dean, 'a1', { type: 'INFORMATION' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
  })
})

describe('ApplicationProcessService — scope', () => {
  it('декан чужого факультета → FORBIDDEN', async () => {
    const { service } = setup({ ...base, status: 'SUBMITTED', facultyId: 'other' })
    await expect(service.take(dean, 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  // Регрессия D-F01: черновик студент никуда не подавал — для обработчика его нет (404).
  it('неподанная заявка (черновик) обработчику не находится → NOT_FOUND', async () => {
    const { service, prisma } = setup({ ...base, status: 'DRAFT' })
    prisma.application.findFirst.mockResolvedValue(null)
    await expect(service.assign(dean, 'a1', 'u2')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(prisma.application.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', deletedAt: null, AND: [{ submittedAt: { not: null } }] },
      }),
    )
  })
})

describe('ApplicationProcessService — справка об обучении', () => {
  const inPreparation = {
    id: 'app-1',
    number: 'SH-2026-001842',
    status: 'IN_PREPARATION',
    deliveryType: 'ELECTRONIC',
    studentId: 'stu-1',
    facultyId: 'fac',
    universityId: 'uni',
    assignedToId: 'dean',
    dueAt: null,
    service: { nameRu: 'Справка об обучении' },
  }

  it('формируется только на этапе подготовки', async () => {
    const { service } = setup({ ...inPreparation, status: 'IN_REVIEW' })
    await expect(service.issueStudyCertificate(dean, 'app-1', 'ru')).rejects.toThrow(AppException)
  })

  it('регистрирует документ в журнале ДО рендера и выдаёт студенту', async () => {
    const { service, documents, exportRegistry, branding } = setup(inPreparation)

    const result = await service.issueStudyCertificate(dean, 'app-1', 'ru')

    expect(result.verificationCode).toBe('JT9ZPNDD')
    // Код проверки печатается внутри документа, поэтому запись в журнале обязана быть
    // раньше брендирования и рендера.
    expect(exportRegistry.registerExclusive).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'pdf',
        context: expect.objectContaining({ kind: 'certificate' }),
        document: expect.objectContaining({ documentNumber: 'SH-2026-001842' }),
      }),
    )
    expect(branding.pdfBranding).toHaveBeenCalledWith(
      expect.objectContaining({ shortId: 'JT9ZPNDD' }),
    )
    // Документ заводится на студента, а не на выдающего сотрудника.
    expect(documents.issueToOwner).toHaveBeenCalledWith(
      dean,
      expect.objectContaining({ ownerId: 'stu-1', type: 'STUDY_PLACE_REF' }),
    )
  })

  it('не выдаёт справку, если её не удалось записать в журнал', async () => {
    const { service, documents, exportRegistry } = setup(inPreparation)
    exportRegistry.registerExclusive.mockResolvedValue(null)

    // Официальный документ без записи в журнале непроверяем — выдавать его нельзя,
    // в отличие от рабочих выгрузок, где сбой журнала терпим.
    await expect(service.issueStudyCertificate(dean, 'app-1', 'ru')).rejects.toThrow(AppException)
    expect(documents.issueToOwner).not.toHaveBeenCalled()
  })

  it('действующая справка по заявке уже есть → CONFLICT, вторую не регистрирует', async () => {
    const { service, exportRegistry } = setup(inPreparation)
    exportRegistry.hasActiveDocument.mockResolvedValue(true)
    const err = await service.issueStudyCertificate(dean, 'app-1', 'ru').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(exportRegistry.registerExclusive).not.toHaveBeenCalled()
  })

  // D-F19: два одновременных «Сформировать» оба проходили проверку чтением. Теперь второй
  // упирается в registerExclusive (проверка и запись под локом номера) и ничего не выдаёт.
  it('гонка: действующая справка появилась между проверкой и записью → CONFLICT', async () => {
    const { service, documents, exportRegistry } = setup(inPreparation)
    exportRegistry.registerExclusive.mockResolvedValue('active')
    const err = await service.issueStudyCertificate(dean, 'app-1', 'ru').catch((e) => e)
    expect(err.code).toBe('CONFLICT')
    expect(documents.uploadFile).not.toHaveBeenCalled()
    expect(documents.issueToOwner).not.toHaveBeenCalled()
  })

  it('выдача сорвалась после регистрации → код отзывается', async () => {
    const { service, documents, exportRegistry } = setup(inPreparation)
    documents.issueToOwner.mockRejectedValue(new Error('minio down'))
    await expect(service.issueStudyCertificate(dean, 'app-1', 'ru')).rejects.toThrow('minio down')
    expect(exportRegistry.revokeByShortId).toHaveBeenCalledWith('JT9ZPNDD')
  })
})

describe('ApplicationProcessService — отзыв справки', () => {
  const issued = {
    id: 'app-1',
    number: 'SH-2026-001842',
    status: 'ISSUED',
    deliveryType: 'ELECTRONIC',
    studentId: 'stu-1',
    facultyId: 'fac',
    universityId: 'uni',
    assignedToId: 'dean',
    dueAt: null,
    service: { nameRu: 'Справка об обучении' },
  }

  it('отзывает по номеру заявки и пишет событие в историю', async () => {
    const { service, exportRegistry, prisma } = setup(issued)

    const result = await service.revokeStudyCertificate(dean, 'app-1', 'выдана ошибочно')

    expect(result.revoked).toBe(1)
    // Журнал — в той же транзакции, что отметка на документе и событие.
    expect(exportRegistry.revokeByDocumentNumber).toHaveBeenCalledWith(
      'SH-2026-001842',
      'certificate',
      expect.objectContaining({ document: prisma.document }),
    )
    expect(prisma.applicationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESULT_REVOKED', comment: 'выдана ошибочно' }),
      }),
    )
  })

  // D-F19: справка в кабинете оставалась «выданной», и студент узнавал об отзыве только по QR.
  it('помечает справку в кабинете студента и уведомляет его', async () => {
    const { service, prisma, queue } = setup(issued)

    await service.revokeStudyCertificate(dean, 'app-1', 'выдана ошибочно')

    expect(prisma.document.updateManyAndReturn).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerId: 'stu-1',
        type: 'STUDY_PLACE_REF',
        issuedByUniversity: true,
        applicationResults: { some: { applicationId: 'app-1' } },
      }),
      data: { status: 'REJECTED', rejectionReason: 'выдана ошибочно' },
      select: { id: true },
    })
    // Отзыв виден и в журнале самого документа.
    expect(prisma.documentEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          actorId: 'dean',
          documentId: 'doc-1',
          action: 'REJECT',
          metadata: { reason: 'выдана ошибочно', revoked: true, viaApplication: 'app-1' },
        },
      ],
    })
    expect(queue.enqueue).toHaveBeenCalledWith(
      'notifications',
      expect.any(String),
      expect.objectContaining({
        recipientIds: ['stu-1'],
        titleKey: 'applications.revoked.title',
        params: { number: 'SH-2026-001842' },
      }),
      expect.anything(),
    )
  })

  it('сообщает, когда отзывать нечего, вместо тихого успеха — и ничего не помечает', async () => {
    const { service, exportRegistry, prisma, queue } = setup(issued)
    exportRegistry.revokeByDocumentNumber.mockResolvedValue(0)

    await expect(service.revokeStudyCertificate(dean, 'app-1')).rejects.toThrow(AppException)
    expect(prisma.document.updateManyAndReturn).not.toHaveBeenCalled()
    expect(prisma.documentEvent.createMany).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('ApplicationProcessService.assign — кому можно поручить заявку', () => {
  it('админу вуза заявки — можно', async () => {
    const { service, prisma, users } = setup({ ...base, status: 'IN_REVIEW' })
    users.findAssigneeScope.mockResolvedValue({
      id: 'ua',
      role: Role.UNIVERSITY_ADMIN,
      universityId: 'uni',
      facultyId: null,
    })

    await service.assign(dean, 'a1', 'ua')

    expect(prisma.application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedToId: 'ua' }) }),
    )
  })

  it('декану другого факультета — нельзя: он заявку даже не увидит', async () => {
    const { service, prisma, users } = setup({ ...base, status: 'IN_REVIEW' })
    users.findAssigneeScope.mockResolvedValue({
      id: 'dean-2',
      role: Role.DEAN,
      universityId: 'uni',
      facultyId: 'fac-2',
    })

    await expect(service.assign(dean, 'a1', 'dean-2')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.application.update).not.toHaveBeenCalled()
  })

  it('студенту, преподавателю или несуществующему id — нельзя', async () => {
    const { service, users } = setup({ ...base, status: 'IN_REVIEW' })
    users.findAssigneeScope.mockResolvedValueOnce({
      id: 'stud-2',
      role: Role.STUDENT,
      universityId: 'uni',
      facultyId: 'fac',
    })
    await expect(service.assign(dean, 'a1', 'stud-2')).rejects.toBeInstanceOf(AppException)

    users.findAssigneeScope.mockResolvedValueOnce(null)
    await expect(service.assign(dean, 'a1', 'ghost')).rejects.toBeInstanceOf(AppException)
  })

  it('список кандидатов — по вузу и факультету заявки', async () => {
    const { service, users } = setup({ ...base, status: 'IN_REVIEW' })
    await service.assignees(dean, 'a1')
    expect(users.listApplicationAssignees).toHaveBeenCalledWith('uni', 'fac')
  })
})

describe('ApplicationProcessService — назначение, готовность, выдача (D-F18)', () => {
  const assignable = {
    id: 'ua',
    role: Role.UNIVERSITY_ADMIN,
    universityId: 'uni',
    facultyId: null,
  }

  it.each(['ISSUED', 'DELIVERED', 'REJECTED', 'CANCELLED'])(
    'закрытую заявку (%s) поручить нельзя',
    async (status) => {
      const { service, prisma, users } = setup({ ...base, status })
      users.findAssigneeScope.mockResolvedValue(assignable)
      await expect(service.assign(dean, 'a1', 'ua')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      expect(prisma.application.update).not.toHaveBeenCalled()
    },
  )

  it('назначение пишется с условием «заявка ещё в работе»', async () => {
    const { service, prisma, users } = setup({ ...base, status: 'IN_PREPARATION' })
    users.findAssigneeScope.mockResolvedValue(assignable)
    await service.assign(dean, 'a1', 'ua')
    const where = prisma.application.update.mock.calls[0][0].where
    expect(where.id).toBe('a1')
    expect(where.status.notIn).toEqual(expect.arrayContaining(['DRAFT', 'ISSUED', 'CANCELLED']))
  })

  it('электронная выдача без результата → «готово» не ставится', async () => {
    const { service, prisma, queue } = setup({
      ...base,
      status: 'IN_PREPARATION',
      deliveryType: 'ELECTRONIC',
    })
    prisma.applicationResult.count.mockResolvedValue(0)
    await expect(service.markReady(dean, 'a1', {})).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(prisma.application.update).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('бумажная выдача без результата — можно: результат и есть бумага', async () => {
    const { service, prisma } = setup({ ...base, status: 'IN_PREPARATION', deliveryType: 'PAPER' })
    prisma.applicationResult.count.mockResolvedValue(0)
    await service.markReady(dean, 'a1', {})
    expect(prisma.application.update.mock.calls[0][0].data.status).toBe('READY_FOR_PICKUP')
  })

  it('выдача с неверным кодом получения → BAD_REQUEST', async () => {
    const { service, prisma } = setup({ ...base, status: 'READY_FOR_PICKUP' })
    await expect(service.issue(dean, 'a1', 'SH-P-00000000')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(prisma.application.update).not.toHaveBeenCalled()
  })

  it('выдача с верным кодом (без учёта регистра) и без кода — проходит', async () => {
    const withCode = setup({ ...base, status: 'READY_FOR_PICKUP' })
    await withCode.service.issue(dean, 'a1', ' sh-p-ab12cd34 ')
    expect(withCode.prisma.application.update.mock.calls[0][0].data.status).toBe('ISSUED')

    const noCode = setup({ ...base, status: 'READY_FOR_PICKUP' })
    await noCode.service.issue(dean, 'a1')
    expect(noCode.prisma.application.findUnique).not.toHaveBeenCalled()
    expect(noCode.prisma.application.update.mock.calls[0][0].data.status).toBe('ISSUED')
  })
})

describe('ApplicationProcessService.addResult — документ из хранилища', () => {
  it('чужой документ к результату не приложить', async () => {
    const { service, prisma, documents } = setup({ ...base, status: 'IN_PREPARATION' })
    documents.isOwnedBy.mockResolvedValue(false)

    await expect(
      service.addResult(dean, 'a1', { type: 'DOCUMENT', documentId: 'doc-of-someone-else' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(documents.isOwnedBy).toHaveBeenCalledWith('doc-of-someone-else', 'stud')
    expect(prisma.applicationResult.create).not.toHaveBeenCalled()
  })

  it('документ самого студента прикладывается', async () => {
    const { service, prisma } = setup({ ...base, status: 'IN_PREPARATION' })
    await service.addResult(dean, 'a1', { type: 'DOCUMENT', documentId: 'doc-own' })
    expect(prisma.applicationResult.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ documentId: 'doc-own' }) }),
    )
  })
})

// Два сотрудника нажали одно действие одновременно (или студент отозвал заявку, пока её
// брали в работу): переход пишется с условием на прочитанный статус, проигравший получает 409.
describe('ApplicationProcessService — гонка переходов (условие на статус в записи)', () => {
  const stale = () =>
    new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '6' })

  it('take пишет переход с условием на прочитанный статус', async () => {
    const { service, prisma } = setup({ ...base, status: 'RESUBMITTED' })
    await service.take(dean, 'a1')
    expect(prisma.application.update.mock.calls[0][0].where).toEqual({
      id: 'a1',
      status: 'RESUBMITTED',
    })
    expect(prisma.applicationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'RESUBMITTED', toStatus: 'IN_REVIEW' }),
      select: { id: true },
    })
  })

  it('заявку взял другой сотрудник между чтением и записью → CONFLICT, без события и сигналов', async () => {
    const { service, prisma, queue, realtime } = setup({ ...base, status: 'SUBMITTED' })
    prisma.application.update.mockRejectedValueOnce(stale())
    await expect(service.take(dean, 'a1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.applicationEvent.create).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(realtime.emitEventToUser).not.toHaveBeenCalled()
  })

  it('отказ, проигравший гонку, студента не уведомляет', async () => {
    const { service, prisma, queue, realtime } = setup({ ...base, status: 'IN_REVIEW' })
    prisma.application.update.mockRejectedValueOnce(stale())
    await expect(service.reject(dean, 'a1', 'нет справки')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(realtime.emitEventToUser).not.toHaveBeenCalled()
  })

  it('прочая ошибка базы не выдаётся за конфликт', async () => {
    const { service, prisma } = setup({ ...base, status: 'IN_REVIEW' })
    prisma.application.update.mockRejectedValueOnce(new Error('connection lost'))
    await expect(service.startPreparation(dean, 'a1')).rejects.toThrow('connection lost')
  })

  it('назначение на заявку, закрытую между проверкой и записью → CONFLICT, без события', async () => {
    const { service, prisma, users } = setup({ ...base, status: 'IN_PREPARATION' })
    users.findAssigneeScope.mockResolvedValue({
      id: 'ua',
      role: Role.UNIVERSITY_ADMIN,
      universityId: 'uni',
      facultyId: null,
    })
    prisma.application.update.mockRejectedValueOnce(stale())
    await expect(service.assign(dean, 'a1', 'ua')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.applicationEvent.create).not.toHaveBeenCalled()
  })

  it('успешный переход уведомляет студента с ключом по id события перехода', async () => {
    const { service, queue, realtime } = setup({ ...base, status: 'IN_REVIEW' })
    await service.requestCorrection(dean, 'a1', 'перезагрузите скан')
    const [, , payload, opts] = queue.enqueue.mock.calls[0]
    expect(payload).toMatchObject({ recipientIds: ['stud'], dedupeKey: 'NEEDS_CORRECTION:ev-1' })
    expect(opts).toEqual({ jobId: 'NEEDS_CORRECTION:ev-1' })
    expect(realtime.emitEventToUser).toHaveBeenCalledWith('stud', expect.any(String), 'a1', {
      status: 'NEEDS_CORRECTION',
    })
  })
})
