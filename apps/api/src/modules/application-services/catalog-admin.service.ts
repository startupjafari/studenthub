import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { Role } from '@studenthub/shared-types'
import type {
  ManagedServicesQueryInput,
  ServiceFormFieldInput,
  ServiceRequirementInput,
  UpsertApplicationServiceInput,
} from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { Paginated } from '../../common/http/paginated'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { ApplicationPolicy } from './application.policy'

// Потолки справочника (BACKEND_RULES §5.3): категорий восемь, услуг у вуза — десятки.
const CATEGORIES_LIMIT = 100
const UNIVERSITY_SERVICES_LIMIT = 500
const ITEMS_LIMIT = 100

const ROW_SELECT = {
  id: true,
  code: true,
  universityId: true,
  nameRu: true,
  nameKk: true,
  nameEn: true,
  slaHours: true,
  deliveryModes: true,
  active: true,
  sortOrder: true,
  updatedAt: true,
  category: { select: { id: true, code: true, nameRu: true, nameKk: true, nameEn: true } },
  _count: {
    select: {
      requirements: { where: { active: true } },
      formFields: { where: { active: true } },
    },
  },
} satisfies Prisma.ApplicationServiceSelect

const DETAIL_SELECT = {
  id: true,
  categoryId: true,
  universityId: true,
  code: true,
  nameRu: true,
  nameKk: true,
  nameEn: true,
  descriptionRu: true,
  descriptionKk: true,
  descriptionEn: true,
  instructionsRu: true,
  instructionsKk: true,
  instructionsEn: true,
  slaHours: true,
  deliveryModes: true,
  requiresPickup: true,
  facultyScoped: true,
  active: true,
  sortOrder: true,
  // Выключенные требования и поля — это удалённые из услуги: в редактор они не попадают.
  requirements: {
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    take: ITEMS_LIMIT,
    select: {
      code: true,
      documentType: true,
      titleRu: true,
      titleKk: true,
      titleEn: true,
      description: true,
      required: true,
      allowStorage: true,
      allowUpload: true,
      maxFiles: true,
    },
  },
  formFields: {
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    take: ITEMS_LIMIT,
    select: {
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
    },
  },
} satisfies Prisma.ApplicationServiceSelect

/**
 * Управление каталогом услуг (docs/PROJECT.md §3.2: каталог «настраиваемый, не enum»).
 *
 * Кто что ведёт:
 * - админ платформы — глобальные шаблоны (`universityId = null`), их видят все вузы;
 * - админ вуза — услуги своего вуза. Шаблон он не правит, а «настраивает»: получает копию с
 *   тем же кодом, и копия заменяет шаблон для его студентов (service-visibility.ts). Выключенная
 *   копия убирает услугу из каталога вуза совсем.
 *
 * Требования и поля формы сохраняются списком по `code`. Пропавшие из списка выключаются,
 * а не удаляются: к требованию уже могут быть привязаны документы поданных заявок, а ответы
 * в formData хранятся по коду поля. Удаления услуги нет по той же причине — только выключение.
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly policy: ApplicationPolicy,
  ) {}

  /** Все активные категории — для выбора в форме услуги (каталог студента пустые прячет). */
  async listCategories(viewer: JwtPayload) {
    this.policy.assert(viewer.role, 'manage-services')
    return this.prisma.applicationCategory.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      take: CATEGORIES_LIMIT,
      select: { id: true, code: true, nameRu: true, nameKk: true, nameEn: true },
    })
  }

  /**
   * Таблица услуг. Админ вуза видит свои услуги и шаблоны (у шаблона — id копии вуза, если он
   * уже настроен); админ платформы — шаблоны.
   */
  async list(viewer: JwtPayload, query: ManagedServicesQueryInput) {
    const universityId = this.managedUniversity(viewer)
    const where: Prisma.ApplicationServiceWhereInput = {
      AND: [
        universityId ? { OR: [{ universityId }, { universityId: null }] } : { universityId: null },
        query.categoryId ? { categoryId: query.categoryId } : {},
        query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { nameRu: { contains: query.search, mode: 'insensitive' } },
                { nameKk: { contains: query.search, mode: 'insensitive' } },
                { nameEn: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    }
    const [rows, total, own] = await Promise.all([
      this.prisma.applicationService.findMany({
        where,
        select: ROW_SELECT,
        orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { nameRu: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.applicationService.count({ where }),
      universityId ? this.ownCodes(universityId) : Promise.resolve(new Map<string, string>()),
    ])
    const items = rows.map(({ _count, ...row }) => ({
      ...row,
      isTemplate: row.universityId === null,
      // Копия вуза для шаблона: по ней таблица ведёт в редактор вместо «Настроить».
      customizedId: row.universityId === null ? (own.get(row.code) ?? null) : null,
      requirementsCount: _count.requirements,
      formFieldsCount: _count.formFields,
    }))
    return new Paginated(items, { total })
  }

  /** Карточка услуги для редактора. Шаблон админ вуза открывает только для просмотра. */
  async get(viewer: JwtPayload, id: string) {
    const universityId = this.managedUniversity(viewer)
    const service = await this.prisma.applicationService.findFirst({
      where: {
        id,
        ...(universityId
          ? { OR: [{ universityId }, { universityId: null }] }
          : { universityId: null }),
      },
      select: DETAIL_SELECT,
    })
    if (!service) throw new AppException('NOT_FOUND', 'Услуга не найдена')
    return {
      ...service,
      isTemplate: service.universityId === null,
      editable: this.canEdit(viewer, service.universityId),
    }
  }

  async create(viewer: JwtPayload, input: UpsertApplicationServiceInput, ctx: RequestContext) {
    const universityId = this.managedUniversity(viewer)
    await this.assertCategory(input.categoryId)
    await this.assertCodeFree(universityId, input.code)

    const created = await this.writeNew(universityId, input)
    await this.audit.record({
      userId: viewer.sub,
      action: 'application_service_created',
      entity: 'ApplicationService',
      entityId: created.id,
      metadata: { code: input.code, universityId },
      ...ctx,
    })
    return created
  }

  async update(
    viewer: JwtPayload,
    id: string,
    input: UpsertApplicationServiceInput,
    ctx: RequestContext,
  ) {
    const current = await this.prisma.applicationService.findUnique({
      where: { id },
      select: { id: true, code: true, universityId: true },
    })
    if (!current) throw new AppException('NOT_FOUND', 'Услуга не найдена')
    if (!this.canEdit(viewer, current.universityId)) {
      throw new AppException(
        current.universityId === null ? 'FORBIDDEN' : 'WRONG_SCOPE',
        current.universityId === null
          ? 'Шаблон платформы правит только её администратор — настройте копию для вуза'
          : 'Услуга другого университета',
      )
    }
    // Код — ключ, по которому копия вуза заменяет шаблон и по которому лежат ответы формы.
    // Смена кода молча вернула бы шаблон студентам, поэтому он неизменен.
    if (input.code !== current.code) {
      throw new AppException('BAD_REQUEST', 'Код услуги после создания не меняется')
    }
    await this.assertCategory(input.categoryId)

    await this.prisma.$transaction(async (tx) => {
      await tx.applicationService.update({ where: { id }, data: this.serviceData(input) })
      await this.syncRequirements(tx, id, input.requirements)
      await this.syncFormFields(tx, id, input.formFields)
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'application_service_updated',
      entity: 'ApplicationService',
      entityId: id,
      metadata: { active: input.active },
      ...ctx,
    })
    return { id }
  }

  /**
   * «Настроить для вуза»: копия шаблона в вуз админа с тем же кодом. С этого момента студенты
   * вуза видят копию, а шаблон — нет (service-visibility.ts).
   */
  async customize(viewer: JwtPayload, templateId: string, ctx: RequestContext) {
    this.policy.assert(viewer.role, 'manage-services')
    if (viewer.role !== Role.UNIVERSITY_ADMIN || !viewer.universityId) {
      throw new AppException(
        'FORBIDDEN',
        'Настроить шаблон под себя может только администратор вуза',
      )
    }
    const template = await this.prisma.applicationService.findFirst({
      where: { id: templateId, universityId: null },
      select: DETAIL_SELECT,
    })
    if (!template) throw new AppException('NOT_FOUND', 'Шаблон не найден')
    await this.assertCodeFree(viewer.universityId, template.code)

    const copy = await this.writeNew(viewer.universityId, {
      categoryId: template.categoryId,
      code: template.code,
      nameRu: template.nameRu,
      nameKk: template.nameKk,
      nameEn: template.nameEn,
      descriptionRu: template.descriptionRu,
      descriptionKk: template.descriptionKk,
      descriptionEn: template.descriptionEn,
      instructionsRu: template.instructionsRu,
      instructionsKk: template.instructionsKk,
      instructionsEn: template.instructionsEn,
      slaHours: template.slaHours,
      deliveryModes: template.deliveryModes as UpsertApplicationServiceInput['deliveryModes'],
      requiresPickup: template.requiresPickup,
      facultyScoped: template.facultyScoped,
      active: template.active,
      sortOrder: template.sortOrder,
      requirements: template.requirements,
      formFields: template.formFields.map((f) => ({
        ...f,
        type: f.type as ServiceFormFieldInput['type'],
        options: Array.isArray(f.options)
          ? (f.options as unknown as ServiceFormFieldInput['options'])
          : null,
      })),
    })
    await this.audit.record({
      userId: viewer.sub,
      action: 'application_service_customized',
      entity: 'ApplicationService',
      entityId: copy.id,
      metadata: { templateId, code: template.code },
      ...ctx,
    })
    return copy
  }

  // --- приватные ---

  /** Чей каталог ведёт зритель: id вуза у админа вуза, null (шаблоны) у админа платформы. */
  private managedUniversity(viewer: JwtPayload): string | null {
    this.policy.assert(viewer.role, 'manage-services')
    if (viewer.role === Role.PLATFORM_ADMIN) return null
    if (!viewer.universityId) {
      throw new AppException('FORBIDDEN', 'Профиль без университета не ведёт каталог услуг')
    }
    return viewer.universityId
  }

  private canEdit(viewer: JwtPayload, serviceUniversityId: string | null): boolean {
    if (!this.policy.can(viewer.role, 'manage-services')) return false
    if (viewer.role === Role.PLATFORM_ADMIN) return serviceUniversityId === null
    return serviceUniversityId !== null && serviceUniversityId === viewer.universityId
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.applicationCategory.findFirst({
      where: { id: categoryId, active: true },
      select: { id: true },
    })
    if (!category) throw new AppException('BAD_REQUEST', 'Категория не найдена')
  }

  // Уникальность кода проверяем сами: у шаблонов universityId = null, а в Postgres NULL в
  // составном unique-индексе друг другу не равны — индекс дубль шаблона не поймал бы.
  private async assertCodeFree(universityId: string | null, code: string): Promise<void> {
    const taken = await this.prisma.applicationService.findFirst({
      where: { universityId, code },
      select: { id: true },
    })
    if (taken) throw new AppException('CONFLICT', 'Услуга с таким кодом уже есть')
  }

  private async ownCodes(universityId: string): Promise<Map<string, string>> {
    const own = await this.prisma.applicationService.findMany({
      where: { universityId },
      select: { id: true, code: true },
      take: UNIVERSITY_SERVICES_LIMIT,
    })
    return new Map(own.map((s) => [s.code, s.id]))
  }

  private async writeNew(universityId: string | null, input: UpsertApplicationServiceInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.applicationService.create({
          data: { ...this.serviceData(input), universityId, code: input.code },
          select: { id: true },
        })
        await this.syncRequirements(tx, created.id, input.requirements)
        await this.syncFormFields(tx, created.id, input.formFields)
        return created
      })
    } catch (error) {
      // Гонка двух одновременных созданий с одним кодом у вуза — индекс её поймает.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException('CONFLICT', 'Услуга с таким кодом уже есть')
      }
      throw error
    }
  }

  private serviceData(input: UpsertApplicationServiceInput) {
    return {
      categoryId: input.categoryId,
      nameRu: input.nameRu,
      nameKk: input.nameKk,
      nameEn: input.nameEn,
      descriptionRu: input.descriptionRu || null,
      descriptionKk: input.descriptionKk || null,
      descriptionEn: input.descriptionEn || null,
      instructionsRu: input.instructionsRu || null,
      instructionsKk: input.instructionsKk || null,
      instructionsEn: input.instructionsEn || null,
      slaHours: input.slaHours,
      deliveryModes: input.deliveryModes,
      requiresPickup: input.requiresPickup,
      facultyScoped: input.facultyScoped,
      active: input.active,
      sortOrder: input.sortOrder,
    }
  }

  private async syncRequirements(
    tx: Prisma.TransactionClient,
    serviceId: string,
    items: ServiceRequirementInput[],
  ): Promise<void> {
    for (const [index, item] of items.entries()) {
      const data = {
        documentType: item.documentType || null,
        titleRu: item.titleRu,
        titleKk: item.titleKk,
        titleEn: item.titleEn,
        description: item.description || null,
        required: item.required,
        allowStorage: item.allowStorage,
        allowUpload: item.allowUpload,
        maxFiles: item.maxFiles,
        sortOrder: index,
        active: true,
      }
      await tx.serviceRequirement.upsert({
        where: { serviceId_code: { serviceId, code: item.code } },
        create: { ...data, serviceId, code: item.code },
        update: data,
      })
    }
    await tx.serviceRequirement.updateMany({
      where: { serviceId, active: true, code: { notIn: items.map((i) => i.code) } },
      data: { active: false },
    })
  }

  private async syncFormFields(
    tx: Prisma.TransactionClient,
    serviceId: string,
    items: ServiceFormFieldInput[],
  ): Promise<void> {
    for (const [index, item] of items.entries()) {
      const data = {
        type: item.type,
        labelRu: item.labelRu,
        labelKk: item.labelKk,
        labelEn: item.labelEn,
        placeholderRu: item.placeholderRu || null,
        placeholderKk: item.placeholderKk || null,
        placeholderEn: item.placeholderEn || null,
        required: item.required,
        // Варианты нужны только полям выбора; у остальных — честный NULL, а не пустой массив.
        options: item.options?.length ? item.options : Prisma.DbNull,
        sortOrder: index,
        active: true,
      }
      await tx.serviceFormField.upsert({
        where: { serviceId_code: { serviceId, code: item.code } },
        create: { ...data, serviceId, code: item.code },
        update: data,
      })
    }
    await tx.serviceFormField.updateMany({
      where: { serviceId, active: true, code: { notIn: items.map((i) => i.code) } },
      data: { active: false },
    })
  }
}
