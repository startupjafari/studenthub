import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Контракт домена «Услуги университета» (переработка «Заявок»). Единый источник истины для
// state-machine, формы и фильтров — и для бэкенда (guard/сервис), и для фронта. Значения —
// строки (стиль новых доменов). Старый applications.ts сосуществует до cleanup.

// ── Каталог ──────────────────────────────────────────────────────────────────
export const APPLICATION_CATEGORY_CODES = [
  'ACADEMIC',
  'CERTIFICATES',
  'FINANCIAL',
  'MILITARY',
  'DORMITORY',
  'PERSONAL_DATA',
  'TECHNICAL',
  'OTHER',
] as const
export const ApplicationCategoryCodeSchema = z.enum(APPLICATION_CATEGORY_CODES)
export type ApplicationCategoryCode = z.infer<typeof ApplicationCategoryCodeSchema>

// Способ выдачи услуги (что поддерживает услуга) и выбор студента.
export const DeliveryModeSchema = z.enum(['ELECTRONIC', 'PAPER'])
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>
export const DeliveryTypeSchema = z.enum(['ELECTRONIC', 'PAPER', 'BOTH'])
export type DeliveryType = z.infer<typeof DeliveryTypeSchema>

export const ProcessingModeSchema = z.enum(['MANUAL', 'AUTOMATIC', 'HYBRID'])
export type ProcessingMode = z.infer<typeof ProcessingModeSchema>

export const FormFieldTypeSchema = z.enum([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'RADIO',
  'CHECKBOX',
  'BOOLEAN',
])
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>

// ── Статусная модель (§7) ────────────────────────────────────────────────────
export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'NEEDS_CORRECTION',
  'RESUBMITTED',
  'IN_PREPARATION',
  'READY',
  'READY_FOR_PICKUP',
  'ISSUED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
] as const
export const ApplicationServiceStatusSchema = z.enum(APPLICATION_STATUSES)
export type ApplicationServiceStatus = z.infer<typeof ApplicationServiceStatusSchema>

// Единый граф допустимых переходов (SSOT). Бэкенд — финальный источник истины: любой переход
// проверяется здесь, даже если фронт скрыл кнопку. Business-action → целевой статус решает сервис.
// CANCELLED — отзыв студентом, «до начала подготовки» (§9): в том числе пока заявку
// проверяют (IN_REVIEW) и после повторной отправки (RESUBMITTED).
export const APPLICATION_TRANSITIONS: Record<ApplicationServiceStatus, ApplicationServiceStatus[]> =
  {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['IN_REVIEW', 'CANCELLED', 'REJECTED'],
    IN_REVIEW: ['NEEDS_CORRECTION', 'IN_PREPARATION', 'REJECTED', 'CANCELLED'],
    NEEDS_CORRECTION: ['RESUBMITTED', 'CANCELLED'],
    RESUBMITTED: ['IN_REVIEW', 'CANCELLED'],
    IN_PREPARATION: ['READY', 'READY_FOR_PICKUP', 'REJECTED'],
    READY: ['DELIVERED', 'READY_FOR_PICKUP'],
    READY_FOR_PICKUP: ['ISSUED', 'DELIVERED'],
    ISSUED: [],
    DELIVERED: [],
    REJECTED: [],
    CANCELLED: [],
  }

// Терминальные статусы — заявка завершена, действий нет.
export const TERMINAL_STATUSES: ApplicationServiceStatus[] = [
  'ISSUED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
]

export function canTransition(
  from: ApplicationServiceStatus,
  to: ApplicationServiceStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to)
}

// Статусы, из которых студент может отозвать заявку. Выводятся из графа, а не перечисляются
// отдельно: раньше это был самостоятельный список, он разошёлся с графом, и кнопка
// «Отозвать» в IN_REVIEW/RESUBMITTED упиралась в «Недопустимый переход».
export const STUDENT_CANCELLABLE_STATUSES: ApplicationServiceStatus[] = APPLICATION_STATUSES.filter(
  (status) => canTransition(status, 'CANCELLED'),
)

// ── Тело запросов ────────────────────────────────────────────────────────────
// Создание черновика: только выбор услуги; остальное заполняется правкой черновика (§8, §30).
export const CreateDraftSchema = z.object({ serviceId: z.string().min(1) }).strict()
export type CreateDraftInput = z.infer<typeof CreateDraftSchema>

// Правка черновика: способ получения + ответы динамической формы (валидация полей — по услуге на бэке).
export const UpdateDraftSchema = z
  .object({
    deliveryType: DeliveryTypeSchema.optional(),
    formData: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type UpdateDraftInput = z.infer<typeof UpdateDraftSchema>

// Отзыв заявки студентом (§9): причина необязательна.
export const CancelApplicationSchema = z
  .object({ reason: z.string().max(2000).optional() })
  .strict()
export type CancelApplicationInput = z.infer<typeof CancelApplicationSchema>

// Комментарий/причина при переходе сотрудника (запрос исправления, отклонение).
export const ApplicationTransitionCommentSchema = z
  .object({ comment: z.string().max(2000).optional() })
  .strict()
export type ApplicationTransitionCommentInput = z.infer<typeof ApplicationTransitionCommentSchema>

// Приложить документ из хранилища к требованию услуги (§3/§4).
export const AttachApplicationDocumentSchema = z
  .object({ requirementId: z.string().min(1), documentId: z.string().min(1) })
  .strict()
export type AttachApplicationDocumentInput = z.infer<typeof AttachApplicationDocumentSchema>

// Запрос замены документа сотрудником — причина обязательна (§4).
export const RequestReplacementSchema = z.object({ comment: z.string().min(1).max(2000) }).strict()
export type RequestReplacementInput = z.infer<typeof RequestReplacementSchema>

// ── Действия сотрудника (PR4) ────────────────────────────────────────────────
export const AssignApplicationSchema = z.object({ userId: z.string().min(1) }).strict()
export type AssignApplicationInput = z.infer<typeof AssignApplicationSchema>

export const RejectApplicationSchema = z.object({ reason: z.string().min(1).max(2000) }).strict()
export type RejectApplicationInput = z.infer<typeof RejectApplicationSchema>

export const RequestCorrectionSchema = z.object({ comment: z.string().min(1).max(2000) }).strict()
export type RequestCorrectionInput = z.infer<typeof RequestCorrectionSchema>

export const ApplicationResultTypeSchema = z.enum([
  'ELECTRONIC_DOCUMENT',
  'PAPER_DOCUMENT',
  'INFORMATION',
  'OTHER',
])
export type ApplicationResultType = z.infer<typeof ApplicationResultTypeSchema>

// Результат заявки. Файл готового документа передаётся как `fileId` — сервер сам заводит
// Document на имя СТУДЕНТА в разделе «Выданные университетом». Если бы документ создавал
// фронт обычным `POST /documents`, владельцем стал бы сотрудник: справка оседала бы в личном
// кабинете декана и не появлялась бы у того, кому её выдали.
// `documentId` остаётся для случая, когда документ уже существует в хранилище.
export const AddApplicationResultSchema = z
  .object({
    type: ApplicationResultTypeSchema,
    documentId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    // Тип из каталога DOCUMENT_TYPES для создаваемого документа (обязателен с `fileId`).
    documentType: z.string().min(1).max(64).optional(),
    documentNumber: z.string().max(100).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine((v) => !(v.fileId && v.documentId), {
    message: 'Укажите либо файл, либо существующий документ',
    path: ['fileId'],
  })
  .refine((v) => !v.fileId || !!v.documentType, {
    message: 'Укажите вид документа',
    path: ['documentType'],
  })
export type AddApplicationResultInput = z.infer<typeof AddApplicationResultSchema>

export const MarkReadySchema = z
  .object({
    pickupLocation: z.string().max(200).optional(),
    pickupInstructions: z.string().max(500).optional(),
  })
  .strict()
export type MarkReadyInput = z.infer<typeof MarkReadySchema>

// Статусы документа заявки (для фронта).
export const APPLICATION_DOCUMENT_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'REPLACEMENT_REQUIRED',
] as const
export const ApplicationDocumentStatusSchema = z.enum(APPLICATION_DOCUMENT_STATUSES)
export type ApplicationDocumentStatus = z.infer<typeof ApplicationDocumentStatusSchema>

// ── Список/очередь (§16, §33): server-side пагинация + фильтры ────────────────
export const ApplicationSortSchema = z.enum(['createdAt', 'submittedAt', 'dueAt', 'status'])
export type ApplicationSort = z.infer<typeof ApplicationSortSchema>

export const ApplicationQuerySchema = OffsetPaginationSchema.extend({
  status: ApplicationServiceStatusSchema.optional(),
  serviceId: z.string().min(1).optional(),
  categoryCode: ApplicationCategoryCodeSchema.optional(),
  facultyId: z.string().min(1).optional(),
  assignedToId: z.string().min(1).optional(),
  search: z.string().max(120).optional(),
  overdue: z.coerce.boolean().optional(),
  dueToday: z.coerce.boolean().optional(),
  sortBy: ApplicationSortSchema.default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict()
export type ApplicationQueryInput = z.infer<typeof ApplicationQuerySchema>

// ── Управление каталогом услуг (§3.2: «настраиваемый, не enum») ──────────────
// Админ вуза ведёт услуги своего вуза, админ платформы — глобальные шаблоны. Шаблон вуз не
// правит, а «настраивает»: получает копию с тем же кодом, и она заменяет шаблон для его
// студентов. Требования и поля формы сохраняются целиком, по `code`: пропавшие из списка
// выключаются, а не удаляются — к ним уже могут быть привязаны документы поданных заявок.

// Код — стабильный идентификатор в рамках услуги/вуза: латиница, цифры и дефис, как у шаблонов.
export const CatalogCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'Латиница, цифры и дефис, 2–60 символов')

const LocalizedTitle = z.string().trim().min(1).max(200)
// Пустая строка из формы и null равнозначны: сервер сохраняет их как null.
const OptionalText = (max: number) => z.string().trim().max(max).nullish()

export const ServiceRequirementInputSchema = z
  .object({
    code: CatalogCodeSchema,
    // Тип из каталога «Документов» — по нему студент выбирает документ из своего хранилища.
    documentType: OptionalText(60),
    titleRu: LocalizedTitle,
    titleKk: LocalizedTitle,
    titleEn: LocalizedTitle,
    description: OptionalText(500),
    required: z.boolean().default(true),
    allowStorage: z.boolean().default(true),
    allowUpload: z.boolean().default(true),
    maxFiles: z.number().int().min(1).max(10).default(1),
  })
  .strict()
export type ServiceRequirementInput = z.infer<typeof ServiceRequirementInputSchema>

export const ServiceFormFieldOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(60),
    labelRu: z.string().trim().min(1).max(120),
    labelKk: z.string().trim().min(1).max(120),
    labelEn: z.string().trim().min(1).max(120),
  })
  .strict()
export type ServiceFormFieldOptionInput = z.infer<typeof ServiceFormFieldOptionSchema>

const CHOICE_FIELD_TYPES: FormFieldType[] = ['SELECT', 'RADIO']

export const ServiceFormFieldInputSchema = z
  .object({
    code: CatalogCodeSchema,
    type: FormFieldTypeSchema,
    labelRu: LocalizedTitle,
    labelKk: LocalizedTitle,
    labelEn: LocalizedTitle,
    placeholderRu: OptionalText(200),
    placeholderKk: OptionalText(200),
    placeholderEn: OptionalText(200),
    required: z.boolean().default(false),
    options: z.array(ServiceFormFieldOptionSchema).max(30).nullish(),
  })
  .strict()
  // Поле выбора без вариантов студент заполнить не сможет, а сервер отклонит любой ответ.
  .refine((f) => !CHOICE_FIELD_TYPES.includes(f.type) || (f.options?.length ?? 0) > 0, {
    message: 'У поля выбора нужен хотя бы один вариант',
    path: ['options'],
  })
export type ServiceFormFieldInput = z.infer<typeof ServiceFormFieldInputSchema>

function uniqueCodes(items: { code: string }[]): boolean {
  return new Set(items.map((i) => i.code)).size === items.length
}

export const UpsertApplicationServiceSchema = z
  .object({
    categoryId: z.string().min(1),
    code: CatalogCodeSchema,
    nameRu: LocalizedTitle,
    nameKk: LocalizedTitle,
    nameEn: LocalizedTitle,
    descriptionRu: OptionalText(2000),
    descriptionKk: OptionalText(2000),
    descriptionEn: OptionalText(2000),
    instructionsRu: OptionalText(4000),
    instructionsKk: OptionalText(4000),
    instructionsEn: OptionalText(4000),
    // До 90 дней: SLA дольше — уже не срок обработки, а отсутствие срока.
    slaHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 90),
    deliveryModes: z.array(DeliveryModeSchema).min(1).max(2),
    requiresPickup: z.boolean().default(false),
    // true — заявку ведёт деканат факультета студента; false — вузовский уровень.
    facultyScoped: z.boolean().default(true),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    requirements: z.array(ServiceRequirementInputSchema).max(30).default([]),
    formFields: z.array(ServiceFormFieldInputSchema).max(40).default([]),
  })
  .strict()
  .refine((s) => new Set(s.deliveryModes).size === s.deliveryModes.length, {
    message: 'Способ выдачи указан дважды',
    path: ['deliveryModes'],
  })
  .refine((s) => uniqueCodes(s.requirements), {
    message: 'Коды документов должны быть разными',
    path: ['requirements'],
  })
  .refine((s) => uniqueCodes(s.formFields), {
    message: 'Коды полей должны быть разными',
    path: ['formFields'],
  })
export type UpsertApplicationServiceInput = z.infer<typeof UpsertApplicationServiceSchema>

export const ManagedServicesQuerySchema = OffsetPaginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1).optional(),
}).strict()
export type ManagedServicesQueryInput = z.infer<typeof ManagedServicesQuerySchema>
