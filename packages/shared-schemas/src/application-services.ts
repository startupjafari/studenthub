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
export const APPLICATION_TRANSITIONS: Record<ApplicationServiceStatus, ApplicationServiceStatus[]> =
  {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['IN_REVIEW', 'CANCELLED', 'REJECTED'],
    IN_REVIEW: ['NEEDS_CORRECTION', 'IN_PREPARATION', 'REJECTED'],
    NEEDS_CORRECTION: ['RESUBMITTED', 'CANCELLED'],
    RESUBMITTED: ['IN_REVIEW'],
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

// До этих статусов заявку редактирует/отзывает студент; после — данные фиксируются.
export const STUDENT_CANCELLABLE_STATUSES: ApplicationServiceStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'NEEDS_CORRECTION',
  'RESUBMITTED',
]

export function canTransition(
  from: ApplicationServiceStatus,
  to: ApplicationServiceStatus,
): boolean {
  return APPLICATION_TRANSITIONS[from].includes(to)
}

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
