import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import {
  APPLICATION_STATUSES,
  STUDENT_CANCELLABLE_STATUSES,
  canTransition,
} from '@studenthub/shared-schemas'
import { ApplicationsService } from './applications.service'
import { ApplicationPolicy } from './application.policy'
import type { PrismaService } from '../../common/prisma/prisma.service'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { ApplicationNotifier } from './application-notifier'

const student: JwtPayload = {
  sub: 'stud',
  role: Role.STUDENT,
  universityId: 'uni',
  facultyId: 'fac',
  groupId: 'g',
}
const dean: JwtPayload = { ...student, sub: 'd', role: Role.DEAN, groupId: null }

// Строку успели перевести между проверкой и записью: update с условием на статус её не нашёл.
const staleStatus = () =>
  new Prisma.PrismaClientKnownRequestError('not found', { code: 'P2025', clientVersion: '6' })

function setup(overrides: Record<string, jest.Mock> = {}) {
  const application = {
    findFirst: jest.fn(),
    findUnique: jest.fn().mockResolvedValue({ documents: [], events: [], results: [] }),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'new' }),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationService = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    // Коды услуг вуза: копия вуза скрывает одноимённый глобальный шаблон (service-visibility.ts).
    findMany: jest.fn().mockResolvedValue([]),
  }
  const serviceFormField = { findMany: jest.fn().mockResolvedValue([]) }
  const serviceRequirement = { findMany: jest.fn().mockResolvedValue([]) }
  const applicationDocument = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  }
  const applicationEvent = { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) }
  const tx = {
    application,
    applicationService,
    serviceFormField,
    serviceRequirement,
    applicationDocument,
    applicationEvent,
    // advisory-лок номера заявки (advisoryXactLock → $executeRaw).
    $executeRaw: jest.fn().mockResolvedValue(0),
  }
  const prisma = {
    ...tx,
    university: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Almaty' }) },
    $transaction: jest.fn((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (t: typeof tx) => unknown)(tx)
        : Promise.all(arg as Promise<unknown>[]),
    ),
    ...overrides,
  }
  // Сигналы обработчикам — отдельный сервис (application-notifier.spec.ts); здесь — что их зовут.
  const notifier = { notifyHandlers: jest.fn().mockResolvedValue(undefined) }
  const service = new ApplicationsService(
    prisma as unknown as PrismaService,
    new ApplicationPolicy(),
    notifier as unknown as ApplicationNotifier,
  )
  return {
    service,
    prisma,
    application,
    applicationService,
    serviceFormField,
    serviceRequirement,
    applicationDocument,
    notifier,
  }
}

describe('ApplicationsService.createDraft', () => {
  it('без университета → BAD_REQUEST', async () => {
    const { service } = setup()
    const noUni = { ...student, universityId: null }
    await expect(service.createDraft(noUni, 's1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('услуга не найдена → NOT_FOUND', async () => {
    const { service, applicationService } = setup()
    applicationService.findFirst.mockResolvedValue(null)
    await expect(service.createDraft(student, 's1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('ApplicationsService.submit — gating', () => {
  const draft = {
    id: 'a1',
    studentId: 'stud',
    status: 'DRAFT',
    serviceId: 's1',
    deliveryType: null,
    formData: {},
  }

  it('без способа получения → BAD_REQUEST', async () => {
    const { service, application, applicationService } = setup()
    application.findFirst.mockResolvedValue(draft)
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('не приложен обязательный документ → BAD_REQUEST', async () => {
    const { service, application, applicationService, serviceRequirement } = setup()
    application.findFirst.mockResolvedValue({ ...draft, deliveryType: 'ELECTRONIC' })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    serviceRequirement.findMany.mockResolvedValue([{ id: 'r1', titleRu: 'Удостоверение' }])
    // applicationDocument.findMany → [] (по умолчанию) → требование не покрыто
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('пишет с условием status=DRAFT — повторная отправка не перевыпускает номер', async () => {
    const { service, application, applicationService } = setup()
    application.findFirst.mockResolvedValue({ ...draft, deliveryType: 'ELECTRONIC' })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    await service.submit(student, 'a1')
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', status: 'DRAFT' } }),
    )
  })

  // Двойное «Отправить»: оба запроса прочитали DRAFT, первый уже записал SUBMITTED.
  it('заявку уже отправили параллельным запросом → CONFLICT, без события', async () => {
    const { service, application, applicationService, prisma } = setup()
    application.findFirst.mockResolvedValue({ ...draft, deliveryType: 'ELECTRONIC' })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    application.update.mockRejectedValue(staleStatus())
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(prisma.applicationEvent.create).not.toHaveBeenCalled()
  })
})

describe('ApplicationsService.submit — услуга, анкета, номер, сигналы (D-F15/D-F16/D-F17)', () => {
  const ready = {
    id: 'a1',
    studentId: 'stud',
    status: 'DRAFT',
    serviceId: 's1',
    deliveryType: 'ELECTRONIC',
    formData: {},
  }
  const field = (over: Record<string, unknown> = {}) => ({
    code: 'purpose',
    type: 'TEXT',
    required: false,
    options: null,
    validation: null,
    labelRu: 'Цель',
    ...over,
  })

  // Черновик услуги, которую вуз потом выключил: та же видимость, что в каталоге.
  it('услуга больше не видна студенту → BAD_REQUEST, номер не выдаётся', async () => {
    const { service, application, applicationService } = setup()
    application.findFirst.mockResolvedValue(ready)
    applicationService.findFirst.mockResolvedValue(null)
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(applicationService.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ id: 's1' }, expect.objectContaining({ active: true })] },
      }),
    )
    expect(application.update).not.toHaveBeenCalled()
  })

  it('значение не того типа (NUMBER) → BAD_REQUEST', async () => {
    const { service, application, applicationService, serviceFormField } = setup()
    application.findFirst.mockResolvedValue({ ...ready, formData: { copies: 'много' } })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    serviceFormField.findMany.mockResolvedValue([field({ code: 'copies', type: 'NUMBER' })])
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(application.update).not.toHaveBeenCalled()
  })

  it('правило поля из validation применяется (maxLength)', async () => {
    const { service, application, applicationService, serviceFormField } = setup()
    application.findFirst.mockResolvedValue({ ...ready, formData: { purpose: 'x'.repeat(11) } })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    serviceFormField.findMany.mockResolvedValue([field({ validation: { maxLength: 10 } })])
    await expect(service.submit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('номер — следующий за последним в году, под локом; лишние ключи анкеты не сохраняются', async () => {
    const { service, application, applicationService, serviceFormField, prisma } = setup()
    application.findFirst
      .mockResolvedValueOnce({ ...ready, formData: { purpose: 'по месту требования', junk: 1 } })
      // Последний выданный номер года (ORDER BY number DESC LIMIT 1).
      .mockResolvedValueOnce({ number: `SH-2026-000041` })
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    serviceFormField.findMany.mockResolvedValue([field()])
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T06:00:00.000Z'))
    try {
      await service.submit(student, 'a1')
    } finally {
      jest.useRealTimers()
    }
    expect(prisma.$executeRaw).toHaveBeenCalled()
    expect(application.count).not.toHaveBeenCalled()
    expect(application.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { number: { startsWith: 'SH-2026-' } },
        orderBy: { number: 'desc' },
      }),
    )
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'SH-2026-000042',
          formData: { purpose: 'по месту требования' },
        }),
      }),
    )
  })

  it('первая заявка года получает 000001', async () => {
    const { service, application, applicationService } = setup()
    application.findFirst.mockResolvedValueOnce(ready).mockResolvedValueOnce(null)
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    await service.submit(student, 'a1')
    const number = application.update.mock.calls[0][0].data.number as string
    expect(number).toMatch(/^SH-\d{4}-000001$/)
  })

  it('после подачи обработчики получают сигнал «новая заявка»', async () => {
    const { service, application, applicationService, notifier } = setup()
    application.findFirst.mockResolvedValue(ready)
    applicationService.findFirst.mockResolvedValue({ deliveryModes: ['ELECTRONIC'], slaHours: 8 })
    application.update.mockResolvedValue({ id: 'a1', number: 'SH-2026-000001' })
    await service.submit(student, 'a1')
    expect(notifier.notifyHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' }),
      'submitted',
      'ev-1',
    )
  })

  it('исправленная заявка — сигнал «отправлена повторно»', async () => {
    const { service, application, notifier } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
      serviceId: 's1',
    })
    application.update.mockResolvedValue({ id: 'a1' })
    await service.resubmit(student, 'a1')
    expect(notifier.notifyHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' }),
      'resubmitted',
      'ev-1',
    )
  })
})

describe('ApplicationsService.updateDraft — только поля анкеты', () => {
  it('ключи, которых нет в анкете, в черновик не попадают', async () => {
    const { service, application, serviceFormField } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'stud', status: 'DRAFT' })
    serviceFormField.findMany.mockResolvedValue([{ code: 'purpose' }])
    await service.updateDraft(student, 'a1', { formData: { purpose: 'банк', other: 'x' } })
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { formData: { purpose: 'банк' } } }),
    )
  })
})

describe('ApplicationsService.updateDraft — условие на статус', () => {
  it('черновик отправили между проверкой и записью → CONFLICT', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'stud', status: 'DRAFT' })
    application.update.mockRejectedValue(staleStatus())
    await expect(service.updateDraft(student, 'a1', { formData: { x: 1 } })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', status: 'DRAFT' } }),
    )
  })
})

describe('ApplicationsService.cancel / resubmit', () => {
  it('cancel из IN_PREPARATION → BAD_REQUEST (уже нельзя отозвать)', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'IN_PREPARATION',
    })
    await expect(service.cancel(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('cancel из DRAFT → CANCELLED', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'stud', status: 'DRAFT' })
    await service.cancel(student, 'a1')
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    )
  })

  // «До начала подготовки» (§9): декан уже взял заявку или студент только что отправил
  // исправление — кнопка «Отозвать» видна, и сервер обязан её пропустить.
  it.each(['IN_REVIEW', 'RESUBMITTED'])('cancel из %s → CANCELLED', async (status) => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'stud', status })
    await service.cancel(student, 'a1')
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', status },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    )
  })

  // Сервер и клиенты решают про отзыв по одному правилу: что отзываемо по списку, то и
  // проходит граф переходов, и наоборот. Расхождение двух констант и было причиной бага.
  it.each(APPLICATION_STATUSES)('статус %s: список отзываемых совпадает с графом', (status) => {
    expect(STUDENT_CANCELLABLE_STATUSES.includes(status)).toBe(canTransition(status, 'CANCELLED'))
  })

  it('отзыв возможен только до начала подготовки', () => {
    expect([...STUDENT_CANCELLABLE_STATUSES].sort()).toEqual(
      ['DRAFT', 'IN_REVIEW', 'NEEDS_CORRECTION', 'RESUBMITTED', 'SUBMITTED'].sort(),
    )
  })

  it('resubmit с незамёненными документами → BAD_REQUEST', async () => {
    const { service, application, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
    })
    applicationDocument.count.mockResolvedValue(1) // остались REPLACEMENT_REQUIRED
    await expect(service.resubmit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  // Регрессия D-F03: документ «к замене» удалили вместо замены — строк REPLACEMENT_REQUIRED
  // нет, но обязательное требование не покрыто.
  it('resubmit без обязательного документа (удалён вместо замены) → BAD_REQUEST', async () => {
    const { service, application, serviceRequirement } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
      serviceId: 's1',
    })
    serviceRequirement.findMany.mockResolvedValue([{ id: 'r1', titleRu: 'Удостоверение' }])
    // applicationDocument.findMany → [] (по умолчанию): приложенного документа нет.
    await expect(service.resubmit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(application.update).not.toHaveBeenCalled()
  })

  // Приложенный документ потом удалили из хранилища (или сняли с него все страницы):
  // строка привязки осталась, а открыть по заявке нечего.
  it('комплект считается только по живым документам со страницами', async () => {
    const { service, application, serviceRequirement, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
      serviceId: 's1',
    })
    serviceRequirement.findMany.mockResolvedValue([{ id: 'r1', titleRu: 'Удостоверение' }])
    // Живого документа по требованию нет — выборка с условием на документ пуста.
    applicationDocument.findMany.mockResolvedValue([])
    await expect(service.resubmit(student, 'a1')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(applicationDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          document: { is: { deletedAt: null, files: { some: {} } } },
        }),
      }),
    )
  })

  it('resubmit с полным комплектом → RESUBMITTED с условием на NEEDS_CORRECTION', async () => {
    const { service, application, serviceRequirement, applicationDocument } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
      serviceId: 's1',
    })
    serviceRequirement.findMany.mockResolvedValue([{ id: 'r1', titleRu: 'Удостоверение' }])
    applicationDocument.findMany.mockResolvedValue([{ requirementId: 'r1' }])
    await service.resubmit(student, 'a1')
    expect(application.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', status: 'NEEDS_CORRECTION' },
        data: { status: 'RESUBMITTED' },
      }),
    )
  })

  it('resubmit, а заявку уже отправили повторно параллельным запросом → CONFLICT', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      id: 'a1',
      studentId: 'stud',
      status: 'NEEDS_CORRECTION',
      serviceId: 's1',
    })
    application.update.mockRejectedValue(staleStatus())
    await expect(service.resubmit(student, 'a1')).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('чужая заявка → WRONG_SCOPE', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({ id: 'a1', studentId: 'other', status: 'DRAFT' })
    await expect(service.cancel(student, 'a1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
  })
})

// Регрессия: староста видел все поданные заявки одногруппников (ФИО, услуга, статус) через
// GET /applications/group-requests. Название услуги само раскрывает тему — академический отпуск,
// военный стол, финансы. «Групповых обращений» в модели нет, поэтому старосте чужие заявки не
// видны вообще: у него права студента — только свои (PROJECT.md §2.2, §11.1).
describe('ApplicationsService — староста видит только свои заявки', () => {
  const query = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' } as never
  const starosta: JwtPayload = {
    sub: 'st',
    role: Role.STAROSTA,
    universityId: 'uni',
    facultyId: 'fac',
    groupId: 'g',
  }

  it('отдельной выборки «обращений группы» больше нет', () => {
    const { service } = setup()
    expect((service as unknown as Record<string, unknown>).listGroupRequests).toBeUndefined()
  })

  it('список — только по себе, без фильтра по группе', async () => {
    const { service, application } = setup()
    await service.list(starosta, query)
    const where = application.findMany.mock.calls[0][0].where as Record<string, unknown>
    expect(where.AND as unknown[]).toContainEqual({ studentId: 'st' })
    expect(JSON.stringify(where)).not.toContain('groupId')
  })

  it('заявка одногруппника по id → WRONG_SCOPE', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'classmate',
      facultyId: 'fac',
      universityId: 'uni',
    })
    await expect(service.getById(starosta, 'a1')).rejects.toMatchObject({ code: 'WRONG_SCOPE' })
    expect(application.findUnique).not.toHaveBeenCalled()
  })
})

// Регрессия D-F01: черновик — не обращение, сотрудник его не видит ни в очереди, ни по id.
describe('ApplicationsService — неподанные заявки видит только автор', () => {
  const query = { page: 1, limit: 20, sortBy: 'submittedAt', sortOrder: 'desc' } as never
  const notSubmitted = { submittedAt: { not: null } }

  it('очередь сотрудника (декан, админ вуза, админ платформы) — без неподанных', async () => {
    const uniAdmin: JwtPayload = { ...dean, role: Role.UNIVERSITY_ADMIN }
    const platformAdmin: JwtPayload = { ...dean, role: Role.PLATFORM_ADMIN }
    for (const viewer of [dean, uniAdmin, platformAdmin]) {
      const { service, application } = setup()
      await service.list(viewer, query)
      const and = application.findMany.mock.calls[0][0].where.AND as Record<string, unknown>[]
      expect(and).toContainEqual(notSubmitted)
      // Счётчик пагинации — по тому же условию.
      expect(application.count.mock.calls[0][0].where.AND).toContainEqual(notSubmitted)
    }
  })

  it('студент свои черновики в списке видит', async () => {
    const { service, application } = setup()
    await service.list(student, query)
    const and = application.findMany.mock.calls[0][0].where.AND as Record<string, unknown>[]
    expect(and).toContainEqual({ studentId: 'stud' })
    expect(and).not.toContainEqual(notSubmitted)
  })

  it('чужой черновик по id для сотрудника → NOT_FOUND', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue(null)
    await expect(service.getById(dean, 'a1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(application.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', deletedAt: null, AND: [notSubmitted] } }),
    )
  })

  it('свой черновик по id студент открывает', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
    })
    await service.getById(student, 'a1')
    expect(application.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', deletedAt: null, AND: [{}] } }),
    )
  })
})

// Регрессия D-F06: обработчик видел только первую страницу документа заявки.
describe('ApplicationsService.getById — страницы документов', () => {
  it('отдаёт все страницы документа плоским списком files, прежние поля не меняются', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
    })
    const pages = [
      { id: 'f1', mime: 'image/jpeg', order: 0 },
      { id: 'f2', mime: 'image/jpeg', order: 1 },
    ]
    application.findUnique.mockResolvedValue({
      id: 'a1',
      events: [],
      results: [],
      documents: [
        { id: 'ad1', documentId: 'doc1', status: 'PENDING', document: { files: pages } },
        { id: 'ad2', documentId: null, status: 'PENDING', document: null },
      ],
    })
    const app = await service.getById(dean, 'a1')
    expect(app?.documents).toEqual([
      { id: 'ad1', documentId: 'doc1', status: 'PENDING', files: pages },
      { id: 'ad2', documentId: null, status: 'PENDING', files: [] },
    ])
    const select = application.findUnique.mock.calls[0][0].select.documents.select
    expect(select.document.select.files.take).toBeGreaterThan(0)
  })

  // D-F18: код получения генерировался и нигде не показывался.
  it('отдаёт код получения оригинала', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
    })
    await service.getById(student, 'a1')
    expect(application.findUnique.mock.calls[0][0].select.pickupCode).toBe(true)
  })
})

describe('ApplicationsService.list — «срок сегодня»', () => {
  it('сутки считаются по часам вуза, а не сервера', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T21:00:00.000Z')) // 02:00 по Алматы
    try {
      const { service, application } = setup()
      await service.list(dean, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        dueToday: true,
      } as never)
      const and = application.findMany.mock.calls[0][0].where.AND as Record<string, unknown>[]
      expect(and).toContainEqual({
        dueAt: {
          gte: new Date('2026-10-01T19:00:00.000Z'),
          lt: new Date('2026-10-02T19:00:00.000Z'),
        },
      })
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('ApplicationsService.list — устойчивый порядок страниц', () => {
  it('после поля сортировки — тай-брейкер по id в том же направлении', async () => {
    const { service, application } = setup()
    await service.list(dean, {
      page: 2,
      limit: 20,
      sortBy: 'status',
      sortOrder: 'asc',
    } as never)
    expect(application.findMany.mock.calls[0][0].orderBy).toEqual([
      { status: 'asc' },
      { id: 'asc' },
    ])
  })
})

describe('ApplicationsService.getById — потолки вложенных выборок', () => {
  it('события, документы и результаты — с take; история — по порядку, от первого шага', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
    })
    application.findUnique.mockResolvedValue({
      id: 'a1',
      documents: [],
      results: [],
      // Выборка идёт с конца (desc) — клиенту отдаётся в хронологическом порядке.
      events: [{ id: 'e2' }, { id: 'e1' }],
    })
    const app = await service.getById(student, 'a1')
    expect(app?.events).toEqual([{ id: 'e1' }, { id: 'e2' }])
    const select = application.findUnique.mock.calls[0][0].select
    expect(select.events.take).toBeGreaterThan(0)
    expect(select.events.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    expect(select.documents.take).toBeGreaterThan(0)
    expect(select.results.take).toBeGreaterThan(0)
  })
})

describe('ApplicationsService.getById — id сотрудника не уходит в историю', () => {
  it('у назначения прежнего формата (id в comment) comment не отдаётся', async () => {
    const { service, application } = setup()
    application.findFirst.mockResolvedValue({
      studentId: 'stud',
      facultyId: 'fac',
      universityId: 'uni',
    })
    application.findUnique.mockResolvedValue({
      id: 'a1',
      documents: [],
      results: [],
      events: [
        { id: 'e2', action: 'ASSIGNED', comment: 'staff-uuid' },
        { id: 'e1', action: 'REJECTED', comment: 'нет справки' },
      ],
    })
    const app = await service.getById(student, 'a1')
    expect(app?.events).toEqual([
      { id: 'e1', action: 'REJECTED', comment: 'нет справки' },
      { id: 'e2', action: 'ASSIGNED', comment: null },
    ])
  })
})
