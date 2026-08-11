import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  APPLICATION_TRANSITIONS,
  STUDENT_CANCELLABLE_STATUSES,
  type DeliveryType,
  type ApplicationServiceStatus,
  type UpdateDraftInput,
  type ApplicationQueryInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { ApplicationPolicy } from './application.policy'

// Поля заявки для scope-проверок (без загрузки всей записи).
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
  ) {}

  /** Создать черновик заявки на услугу (§8/§30). Заполняется правкой черновика. */
  async createDraft(viewer: JwtPayload, serviceId: string) {
    this.policy.assert(viewer.role, 'create')
    if (!viewer.universityId) {
      throw new AppException('BAD_REQUEST', 'Профиль без университета не может подавать заявки')
    }
    const service = await this.prisma.applicationService.findFirst({
      where: {
        id: serviceId,
        active: true,
        OR: [{ universityId: null }, { universityId: viewer.universityId }],
      },
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
      data.formData = dto.formData as Prisma.InputJsonValue
    }
    return this.prisma.application.update({ where: { id }, data, select: APP_SELECT })
  }

  /** Отправить заявку: DRAFT → SUBMITTED. Присваивает номер, срок по SLA, валидирует форму (§13/§14/§40). */
  async submit(viewer: JwtPayload, id: string) {
    const app = await this.loadOwnedDraft(viewer, id)
    const service = await this.serviceOf(app.serviceId)

    // Способ получения обязателен и должен быть допустим для услуги.
    if (!app.deliveryType) {
      throw new AppException('BAD_REQUEST', 'Выберите способ получения')
    }
    this.assertDeliveryAllowed(app.deliveryType as DeliveryType, service.deliveryModes)
    await this.assertFormValid(app.serviceId, app.formData)

    const now = new Date()
    const dueAt = new Date(now.getTime() + service.slaHours * 3_600_000)
    // Номер SH-YYYY-NNNNNN. Уникальность гарантирует БД; при гонке — повтор транзакции.
    return this.withNumberRetry(now.getFullYear(), (number) =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.application.update({
          where: { id },
          data: { status: 'SUBMITTED', number, submittedAt: now, dueAt },
          select: APP_SELECT,
        })
        await tx.applicationEvent.create({
          data: {
            applicationId: id,
            actorId: viewer.sub,
            action: 'SUBMITTED',
            fromStatus: 'DRAFT',
            toStatus: 'SUBMITTED',
          },
        })
        return updated
      }),
    )
  }

  /** Отозвать заявку (§9): статус → CANCELLED. Только владелец и до начала подготовки. */
  async cancel(viewer: JwtPayload, id: string, reason?: string) {
    const app = await this.loadOwned(viewer, id)
    const status = app.status as ApplicationServiceStatus
    if (!STUDENT_CANCELLABLE_STATUSES.includes(status)) {
      throw new AppException('BAD_REQUEST', 'Эту заявку уже нельзя отозвать')
    }
    if (!APPLICATION_TRANSITIONS[status].includes('CANCELLED')) {
      throw new AppException('BAD_REQUEST', 'Недопустимый переход')
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
        select: APP_SELECT,
      })
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

  /** Список/очередь по scope роли (§16/§33): server-side пагинация + фильтры. */
  async list(viewer: JwtPayload, query: ApplicationQueryInput): Promise<Paginated<unknown>> {
    const where = this.buildWhere(viewer, query)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        select: APP_SELECT,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.application.count({ where }),
    ])
    return new Paginated(rows, { total })
  }

  /** Деталь заявки + человеческий timeline. Scope проверяется политикой (§22, защита от IDOR). */
  async getById(viewer: JwtPayload, id: string) {
    const scope = await this.prisma.application.findFirst({
      where: { id, deletedAt: null },
      select: SCOPE_SELECT,
    })
    if (!scope) {
      throw new AppException('NOT_FOUND', 'Заявка не найдена')
    }
    this.policy.assertCanRead(viewer, scope)
    return this.prisma.application.findUnique({
      where: { id },
      select: {
        ...APP_SELECT,
        rejectionReason: true,
        pickupLocation: true,
        pickupInstructions: true,
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
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
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
      },
    })
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private buildWhere(
    viewer: JwtPayload,
    query: ApplicationQueryInput,
  ): Prisma.ApplicationWhereInput {
    const now = new Date()
    const and: Prisma.ApplicationWhereInput[] = [
      { deletedAt: null },
      this.policy.scopeWhere(viewer),
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
    if (query.dueToday) {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start.getTime() + 86_400_000)
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

  // Проверка ответов формы: обязательные поля заполнены; для SELECT/RADIO — значение из options.
  private async assertFormValid(serviceId: string, formData: Prisma.JsonValue): Promise<void> {
    const fields = await this.prisma.serviceFormField.findMany({
      where: { serviceId, active: true },
      select: { code: true, required: true, type: true, options: true, labelRu: true },
    })
    const data = (formData && typeof formData === 'object' ? formData : {}) as Record<
      string,
      unknown
    >
    for (const f of fields) {
      const value = data[f.code]
      const empty = value === undefined || value === null || value === ''
      if (f.required && empty) {
        throw new AppException('BAD_REQUEST', `Заполните поле: ${f.labelRu}`)
      }
      if (!empty && (f.type === 'SELECT' || f.type === 'RADIO') && Array.isArray(f.options)) {
        const allowed = (f.options as Array<{ value?: unknown }>).map((o) => o?.value)
        if (!allowed.includes(value)) {
          throw new AppException('BAD_REQUEST', `Недопустимое значение поля: ${f.labelRu}`)
        }
      }
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

  // Генерация номера с повтором при гонке (unique на number).
  private async withNumberRetry<T>(year: number, run: (number: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await this.prisma.application.count({
        where: { number: { startsWith: `SH-${year}-` } },
      })
      const number = `SH-${year}-${String(count + 1 + attempt).padStart(6, '0')}`
      try {
        return await run(number)
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue
        }
        throw error
      }
    }
    throw new AppException('CONFLICT', 'Не удалось присвоить номер заявки, повторите')
  }
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
