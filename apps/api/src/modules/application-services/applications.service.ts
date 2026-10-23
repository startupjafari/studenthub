import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  canTransition,
  type DeliveryType,
  type ApplicationServiceStatus,
  type UpdateDraftInput,
  type ApplicationQueryInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { visibleServicesWhere } from './service-visibility'
import { ApplicationPolicy } from './application.policy'
import { ApplicationNotifier } from './application-notifier'
import { formDataError, pickFormFields, type FormFieldRule } from './form-validation'
import { rethrowStaleStatus } from '../../common/prisma/stale-status'
import { advisoryXactLock } from '../../common/prisma/advisory-lock'
import { localDateString, localDayRange } from '../../common/time/local-label'

// Поля заявки для scope-проверок (без загрузки всей записи).
// Потолки на выборки (BACKEND_RULES §7.2). Анкета услуги и её список требований —
// справочники, которые заводит вуз: они малы, но не ограничены схемой.
const SERVICE_FORM_FIELDS_LIMIT = 100
const SERVICE_REQUIREMENTS_LIMIT = 100
// Страниц у одного документа — тот же потолок, что в домене «Документы».
const DOCUMENT_FILES_LIMIT = 30
// История заявки: десятки событий за жизнь заявки, потолок — с большим запасом. Берутся
// последние, чтобы при упоре в потолок обрезалось начало истории, а не свежие шаги.
const APPLICATION_EVENTS_LIMIT = 500
// Результатов по заявке — единицы (справка, перевыпуск после отзыва, бумажный оригинал).
const APPLICATION_RESULTS_LIMIT = 100

const SCOPE_SELECT = {
  studentId: true,
  facultyId: true,
  universityId: true,
} satisfies Prisma.ApplicationSelect

// Карточка заявки в списках/деталях.
const APP_SELECT = {
  id: true,
  number: true,
  status: true,
  deliveryType: true,
  formData: true,
  studentId: true,
  facultyId: true,
  universityId: true,
  assignedToId: true,
  submittedAt: true,
  dueAt: true,
  readyAt: true,
  issuedAt: true,
  cancelledAt: true,
  createdAt: true,
  service: {
    select: { id: true, code: true, nameRu: true, nameKk: true, nameEn: true, slaHours: true },
  },
  // Имя студента — для очереди/карточки деканата (§16/§17). Не чувствительно; scope защищает доступ.
  student: { select: { id: true, firstName: true, lastName: true, groupId: true } },
} satisfies Prisma.ApplicationSelect

// Допустимые способы получения по набору режимов услуги.
function allowedDeliveryTypes(modes: string[]): DeliveryType[] {
  const hasE = modes.includes('ELECTRONIC')
  const hasP = modes.includes('PAPER')
  const out: DeliveryType[] = []
  if (hasE) out.push('ELECTRONIC')
  if (hasP) out.push('PAPER')
  if (hasE && hasP) out.push('BOTH')
  return out
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ApplicationPolicy,
    private readonly notifier: ApplicationNotifier,
  ) {}

  /** Создать черновик заявки на услугу (§8/§30). Заполняется правкой черновика. */
  async createDraft(viewer: JwtPayload, serviceId: string) {
    this.policy.assert(viewer.role, 'create')
    if (!viewer.universityId) {
      throw new AppException('BAD_REQUEST', 'Профиль без университета не может подавать заявки')
    }
    // Та же видимость, что в каталоге: шаблон, заменённый копией вуза, недоступен и по id.
    const visible = await visibleServicesWhere(this.prisma, viewer.universityId)
    const service = await this.prisma.applicationService.findFirst({
      where: { AND: [{ id: serviceId }, visible] },
      select: { id: true, facultyScoped: true },
    })
    if (!service) {
      throw new AppException('NOT_FOUND', 'Услуга не найдена')
    }
    const facultyId = service.facultyScoped ? viewer.facultyId : null
    return this.prisma.$transaction(async (tx) => {
      const app = await tx.application.create({
        data: {
          studentId: viewer.sub,
          universityId: viewer.universityId!,
          facultyId,
          serviceId,
          status: 'DRAFT',
        },
        select: APP_SELECT,
      })
      await tx.applicationEvent.create({
        data: { applicationId: app.id, actorId: viewer.sub, action: 'CREATED', toStatus: 'DRAFT' },
      })
      return app
    })
  }

  /** Правка черновика (способ получения + ответы формы). Только владелец, только DRAFT (§8). */
  async updateDraft(viewer: JwtPayload, id: string, dto: UpdateDraftInput) {
    const app = await this.loadOwnedDraft(viewer, id)
    const data: Prisma.ApplicationUpdateInput = {}
    if (dto.deliveryType !== undefined) {
      const service = await this.serviceOf(app.serviceId)
      this.assertDeliveryAllowed(dto.deliveryType, service.deliveryModes)
      data.deliveryType = dto.deliveryType
    }
    if (dto.formData !== undefined) {
      // В черновик — только ответы на поля анкеты: лишние ключи не храним. Тип и правила
      // полей проверяются при отправке — черновик заполняется по шагам и бывает неполным.
      const fields = await this.formFieldsOf(app.serviceId)
      data.formData = pickFormFields(fields, dto.formData) as Prisma.InputJsonValue
    }
    // Статус — в условии записи: черновик, отправленный параллельным запросом, уже не правится.
    return this.prisma.application
      .update({ where: { id, status: 'DRAFT' }, data, select: APP_SELECT })
      .catch(rethrowStaleStatus)
  }

  /** Отправить заявку: DRAFT → SUBMITTED. Присваивает номер, срок по SLA, валидирует форму (§13/§14/§40). */
  async submit(viewer: JwtPayload, id: string) {
    const app = await this.loadOwnedDraft(viewer, id)
    // Та же видимость, что в каталоге и при создании черновика: черновик услуги, которую
    // вуз или платформа потом выключили (или заменили копией вуза), больше не отправляется.
    const service = await this.visibleServiceOf(viewer, app.serviceId)

    // Способ получения обязателен и должен быть допустим для услуги.
    if (!app.deliveryType) {
      throw new AppException('BAD_REQUEST', 'Выберите способ получения')
    }
    this.assertDeliveryAllowed(app.deliveryType as DeliveryType, service.deliveryModes)
    const fields = await this.formFieldsOf(app.serviceId)
    const formError = formDataError(fields, app.formData)
    if (formError) throw new AppException('BAD_REQUEST', formError)
    await this.assertRequiredDocuments(app.serviceId, id)

    const now = new Date()
    const dueAt = new Date(now.getTime() + service.slaHours * 3_600_000)
    // Год номера — по часам вуза: заявка, поданная в новогоднюю ночь, относится к новому году.
    const year = Number(
      localDateString(now, await this.timezoneOf(viewer.universityId)).slice(0, 4),
    )
    const { updated, eventId } = await this.prisma
      .$transaction(async (tx) => {
        const number = await this.nextNumber(tx, year)
        // Условие на DRAFT в самой записи: двойное «Отправить» (или повтор после таймаута)
        // проходило проверку чтением дважды и перевыпускало номер, а отправка, опоздавшая к
        // взятию заявки в работу, возвращала её из IN_REVIEW в SUBMITTED. Теперь второй
        // запрос получает CONFLICT.
        const u = await tx.application
          .update({
            where: { id, status: 'DRAFT' },
            data: {
              status: 'SUBMITTED',
              number,
              submittedAt: now,
              dueAt,
              // Поданная заявка хранит ответы только на поля анкеты (черновики, сохранённые до
              // этой проверки, могли нести что угодно).
              formData: pickFormFields(fields, app.formData) as Prisma.InputJsonValue,
            },
            select: APP_SELECT,
          })
          .catch(rethrowStaleStatus)
        const event = await tx.applicationEvent.create({
          data: {
            applicationId: id,
            actorId: viewer.sub,
            action: 'SUBMITTED',
            fromStatus: 'DRAFT',
            toStatus: 'SUBMITTED',
          },
          select: { id: true },
        })
        return { updated: u, eventId: event.id }
      })
      .catch(rethrowNumberTaken)
    await this.notifier.notifyHandlers(updated, 'submitted', eventId)
    return updated
  }

  /** Отозвать заявку (§9): статус → CANCELLED. Только владелец и до начала подготовки. */
  async cancel(viewer: JwtPayload, id: string, reason?: string) {
    const app = await this.loadOwned(viewer, id)
    const status = app.status as ApplicationServiceStatus
    // Одна проверка по графу (SSOT): тот же canTransition, по которому клиенты решают,
    // показывать ли «Отозвать». Два списка раньше расходились, и кнопка вела в отказ.
    if (!canTransition(status, 'CANCELLED')) {
      throw new AppException('BAD_REQUEST', 'Эту заявку уже нельзя отозвать')
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.application
        .update({
          where: { id, status },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
          select: APP_SELECT,
        })
        .catch(rethrowStaleStatus)
      await tx.applicationEvent.create({
        data: {
          applicationId: id,
          actorId: viewer.sub,
          action: 'CANCELLED',
          fromStatus: status,
          toStatus: 'CANCELLED',
          comment: reason,
        },
      })
      return updated
    })
  }

  /** Повторная отправка после исправления (§7): NEEDS_CORRECTION → RESUBMITTED. */
  async resubmit(viewer: JwtPayload, id: string) {
    const app = await this.loadOwned(viewer, id)
    if (app.status !== 'NEEDS_CORRECTION') {
      throw new AppException('BAD_REQUEST', 'Заявка не требует повторной отправки')
    }
    const pending = await this.prisma.applicationDocument.count({
      where: { applicationId: id, status: 'REPLACEMENT_REQUIRED' },
    })
    if (pending > 0) {
      throw new AppException('BAD_REQUEST', 'Замените все документы, отмеченные к исправлению')
    }
    // Комплект проверяется заново, как при первой отправке: документ, отмеченный к замене,
    // можно было просто удалить — строк REPLACEMENT_REQUIRED не оставалось, и заявка уходила
    // дальше без обязательного документа.
    await this.assertRequiredDocuments(app.serviceId, id)
    const { updated, eventId } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.application
        .update({
          where: { id, status: 'NEEDS_CORRECTION' },
          data: { status: 'RESUBMITTED' },
          select: APP_SELECT,
        })
        .catch(rethrowStaleStatus)
      const event = await tx.applicationEvent.create({
        data: {
          applicationId: id,
          actorId: viewer.sub,
          action: 'RESUBMITTED',
          fromStatus: 'NEEDS_CORRECTION',
          toStatus: 'RESUBMITTED',
        },
        select: { id: true },
      })
      return { updated: u, eventId: event.id }
    })
    // Исправление ждёт того, кто его просил: без сигнала заявка лежала в очереди незамеченной.
    await this.notifier.notifyHandlers(updated, 'resubmitted', eventId)
    return updated
  }

  /** Список/очередь по scope роли (§16/§33): server-side пагинация + фильтры. */
  async list(viewer: JwtPayload, query: ApplicationQueryInput): Promise<Paginated<unknown>> {
    const timezone = query.dueToday ? await this.timezoneOf(viewer.universityId) : null
    const where = this.buildWhere(viewer, query, timezone)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        select: APP_SELECT,
        // Тай-брейкер по id: у статуса и дат много равных значений, и без уникального ключа
        // порядок строк между запросами страниц не определён — дубли и пропуски на стыках.
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.application.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  /** Деталь заявки + человеческий timeline. Scope проверяется политикой (§22, защита от IDOR). */
  async getById(viewer: JwtPayload, id: string) {
    // Чужой черновик для сотрудника не существует (404), как и в списке.
    const scope = await this.prisma.application.findFirst({
      where: { id, deletedAt: null, AND: [this.policy.submittedOnlyWhere(viewer)] },
      select: SCOPE_SELECT,
    })
    if (!scope) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.policy.assertCanRead(viewer, scope)
    const app = await this.prisma.application.findUnique({
      where: { id },
      select: {
        ...APP_SELECT,
        rejectionReason: true,
        pickupLocation: true,
        pickupInstructions: true,
        // Код получения оригинала: студент показывает его при выдаче, сотрудник сверяет
        // (POST …/issue с pickupCode). Раньше генерировался и нигде не показывался.
        pickupCode: true,
        service: {
          select: {
            id: true,
            code: true,
            nameRu: true,
            nameKk: true,
            nameEn: true,
            slaHours: true,
            descriptionRu: true,
            descriptionKk: true,
            descriptionEn: true,
            // Поля анкеты — чтобы показать ответы formData с подписями (обработчику и
            // студенту): сами ответы хранятся кодами полей. Выключенные поля тоже нужны —
            // ответы на них в поданных заявках остались; `active` отличает действующие.
            formFields: {
              orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
              take: SERVICE_FORM_FIELDS_LIMIT,
              select: {
                id: true,
                code: true,
                type: true,
                labelRu: true,
                labelKk: true,
                labelEn: true,
                placeholderRu: true,
                placeholderKk: true,
                placeholderEn: true,
                required: true,
                options: true,
                validation: true,
                active: true,
              },
            },
          },
        },
        events: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: APPLICATION_EVENTS_LIMIT,
          select: {
            id: true,
            action: true,
            fromStatus: true,
            toStatus: true,
            comment: true,
            actorId: true,
            createdAt: true,
          },
        },
        documents: {
          orderBy: { submittedAt: 'asc' },
          // Строка документа — одна на требование услуги (unique), требований не больше потолка.
          take: SERVICE_REQUIREMENTS_LIMIT,
          select: {
            id: true,
            requirementId: true,
            documentId: true,
            source: true,
            status: true,
            reviewComment: true,
            snapshotTitle: true,
            requirement: {
              select: {
                id: true,
                titleRu: true,
                titleKk: true,
                titleEn: true,
                required: true,
              },
            },
            // Страницы документа (паспорт — разворот и прописка, диплом — с приложением):
            // обработчик открывает каждую, а не только первую.
            document: {
              select: {
                files: {
                  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                  select: { id: true, mime: true, order: true },
                  take: DOCUMENT_FILES_LIMIT,
                },
              },
            },
          },
        },
        results: {
          orderBy: { createdAt: 'desc' },
          take: APPLICATION_RESULTS_LIMIT,
          select: {
            id: true,
            type: true,
            documentId: true,
            documentNumber: true,
            note: true,
            createdAt: true,
          },
        },
      },
    })
    if (!app) return app
    // Поле `files` у строки документа — добавочное: прежние поля ответа не меняются (тот же
    // ответ читают веб, iOS, Android). Ссылку на страницу выдаёт GET …/documents/:docId/url?fileId=.
    return {
      ...app,
      // Выбраны последние события — клиенту история нужна по порядку, от первого шага.
      // У назначений, записанных до переноса id в metadata, в comment лежит id сотрудника —
      // это не текст для истории, наружу его не отдаём.
      events: [...app.events]
        .reverse()
        .map((e) => (e.action === 'ASSIGNED' ? { ...e, comment: null } : e)),
      documents: app.documents.map(({ document, ...doc }) => ({
        ...doc,
        files: document?.files ?? [],
      })),
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Часовой пояс вуза (null — у платформенных ролей вуза нет, считаем в UTC). */
  private async timezoneOf(universityId: string | null | undefined): Promise<string | null> {
    if (!universityId) return null
    const university = await this.prisma.university.findUnique({
      where: { id: universityId },
      select: { timezone: true },
    })
    return university?.timezone ?? null
  }

  private buildWhere(
    viewer: JwtPayload,
    query: ApplicationQueryInput,
    timezone: string | null = null,
  ): Prisma.ApplicationWhereInput {
    const now = new Date()
    const and: Prisma.ApplicationWhereInput[] = [
      { deletedAt: null },
      this.policy.scopeWhere(viewer),
      // Чужие черновики в очередь не попадают (см. ApplicationPolicy.submittedOnlyWhere).
      this.policy.submittedOnlyWhere(viewer),
    ]
    if (query.status) and.push({ status: query.status })
    if (query.serviceId) and.push({ serviceId: query.serviceId })
    if (query.categoryCode) and.push({ service: { category: { code: query.categoryCode } } })
    if (query.facultyId) and.push({ facultyId: query.facultyId })
    if (query.assignedToId) and.push({ assignedToId: query.assignedToId })
    if (query.search) and.push({ number: { contains: query.search, mode: 'insensitive' } })
    // overdue: срок прошёл и заявка ещё в работе (не терминальная, не готова к выдаче).
    if (query.overdue) {
      and.push({ dueAt: { lt: now }, status: { notIn: DONE_OR_READY } })
    }
    // «Сегодня» — по часам вуза, а не сервера.
    if (query.dueToday) {
      const { start, end } = localDayRange(now, timezone)
      and.push({ dueAt: { gte: start, lt: end } })
    }
    return { AND: and }
  }

  private assertDeliveryAllowed(deliveryType: DeliveryType, modes: string[]): void {
    if (!allowedDeliveryTypes(modes).includes(deliveryType)) {
      throw new AppException('BAD_REQUEST', 'Недоступный способ получения для этой услуги')
    }
  }

  private async serviceOf(serviceId: string) {
    const service = await this.prisma.applicationService.findUnique({
      where: { id: serviceId },
      select: { deliveryModes: true, slaHours: true },
    })
    if (!service) {
      throw new AppException('NOT_FOUND', 'Услуга не найдена')
    }
    return service
  }

  /** Услуга черновика, если зритель её всё ещё видит (service-visibility.ts). */
  private async visibleServiceOf(viewer: JwtPayload, serviceId: string) {
    const visible = await visibleServicesWhere(this.prisma, viewer.universityId)
    const service = await this.prisma.applicationService.findFirst({
      where: { AND: [{ id: serviceId }, visible] },
      select: { deliveryModes: true, slaHours: true },
    })
    if (!service) {
      throw new AppException('BAD_REQUEST', 'Услуга больше недоступна — заявку отправить нельзя')
    }
    return service
  }

  /** Действующие поля анкеты услуги — по ним сверяются и сохраняются ответы. */
  private formFieldsOf(serviceId: string): Promise<FormFieldRule[]> {
    return this.prisma.serviceFormField.findMany({
      where: { serviceId, active: true },
      select: {
        code: true,
        required: true,
        type: true,
        options: true,
        validation: true,
        labelRu: true,
      },
      orderBy: { sortOrder: 'asc' },
      take: SERVICE_FORM_FIELDS_LIMIT,
    })
  }

  // Все обязательные требования услуги должны иметь приложенный документ (не «требует замены»).
  // Документ при этом должен быть жив: приложенный и затем удалённый из хранилища (или
  // лишившийся всех страниц) открыть по заявке нельзя — сотрудник получил бы пустое место.
  private async assertRequiredDocuments(serviceId: string, applicationId: string): Promise<void> {
    const reqs = await this.prisma.serviceRequirement.findMany({
      where: { serviceId, active: true, required: true },
      select: { id: true, titleRu: true },
      take: SERVICE_REQUIREMENTS_LIMIT,
    })
    if (!reqs.length) return
    const docs = await this.prisma.applicationDocument.findMany({
      where: {
        applicationId,
        requirementId: { in: reqs.map((r) => r.id) },
        status: { not: 'REPLACEMENT_REQUIRED' },
        document: { is: { deletedAt: null, files: { some: {} } } },
      },
      select: { requirementId: true },
      // Документов не больше, чем требований, по которым мы их и спрашиваем.
      take: SERVICE_REQUIREMENTS_LIMIT,
    })
    const satisfied = new Set(docs.map((d) => d.requirementId))
    const missing = reqs.find((r) => !satisfied.has(r.id))
    if (missing) {
      throw new AppException('BAD_REQUEST', `Приложите документ: ${missing.titleRu}`)
    }
  }

  // Загрузка заявки-владельца (любой статус).
  private async loadOwned(viewer: JwtPayload, id: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, studentId: true, status: true, serviceId: true, deliveryType: true, formData: true }, // prettier-ignore
    })
    if (!app) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    if (app.studentId !== viewer.sub) {
      throw new AppException('WRONG_SCOPE', 'Это не ваша заявка')
    }
    return app
  }

  // Владелец + статус DRAFT (редактирование/отправка).
  private async loadOwnedDraft(viewer: JwtPayload, id: string) {
    const app = await this.loadOwned(viewer, id)
    if (app.status !== 'DRAFT') {
      throw new AppException('BAD_REQUEST', 'Заявку уже нельзя редактировать')
    }
    return app
  }

  /**
   * Следующий номер заявки SH-YYYY-NNNNNN — внутри транзакции подачи, под advisory-локом года.
   *
   * Раньше номер был «число заявок года + 1 + попытка»: COUNT по префиксу на каждую подачу, а
   * при одновременных подачах (начало семестра, сто вузов на одном счётчике) пять попыток
   * упирались в одни и те же номера, и студент получал «Не удалось присвоить номер». Теперь
   * подачи одного года выстраиваются в очередь на время короткой транзакции, и номер — это
   * последний выданный + 1: без пропусков и без повторов. Последний берётся по unique-индексу
   * номера (ORDER BY number DESC LIMIT 1), а не подсчётом строк.
   *
   * Шесть разрядов — миллион заявок в год на платформу; дальше строковый порядок номеров
   * перестаёт совпадать с числовым, и формат придётся расширять.
   */
  private async nextNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
    const prefix = `SH-${year}-`
    await advisoryXactLock(tx, `application-number:${year}`)
    const last = await tx.application.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    })
    const tail = Number.parseInt(last?.number?.slice(prefix.length) ?? '', 10)
    const next = Number.isFinite(tail) ? tail + 1 : 1
    return `${prefix}${String(next).padStart(6, '0')}`
  }
}

/**
 * Номер всё же занят (unique на number) — под локом это возможно только при ручной правке
 * данных. Отвечаем CONFLICT: повтор подачи возьмёт следующий номер.
 */
function rethrowNumberTaken(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppException('CONFLICT', 'Не удалось присвоить номер заявки, повторите')
  }
  throw error
}

// Статусы, при которых заявка «не просрочена по смыслу» (готова/выдана/завершена).
const DONE_OR_READY: ApplicationServiceStatus[] = [
  'READY',
  'READY_FOR_PICKUP',
  'ISSUED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
]
