import { z } from 'zod'

// Схемы модуля «Документы» (Ф15, задача 15.3). Значения enum зеркалят справочник в
// @studenthub/shared-config (DOCUMENT_CATEGORIES/…); сам `type` валидируется как строка,
// а его принадлежность каталогу проверяет сервис (documentTypeDef). Так shared-schemas
// остаётся без зависимости от shared-config, а список из 25 типов не дублируется.

export const DOCUMENT_CATEGORY_VALUES = [
  'PERSONAL',
  'ACADEMIC',
  'CERTIFICATE',
  'ISSUED_BY_UNIVERSITY',
] as const
export const DocumentCategorySchema = z.enum(DOCUMENT_CATEGORY_VALUES)
export type DocumentCategoryValue = z.infer<typeof DocumentCategorySchema>

export const DOCUMENT_STATUS_VALUES = [
  'DRAFT',
  'UPLOADED',
  'IN_REVIEW',
  'VERIFIED',
  'ACCEPTED',
  'REJECTED',
  'NEEDS_REPLACEMENT',
  'EXPIRING',
  'EXPIRED',
  'ARCHIVED',
] as const
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUS_VALUES)

export const DOCUMENT_GRANTEE_VALUES = ['UNIVERSITY', 'DEPARTMENT', 'USER'] as const
export const DocumentGranteeSchema = z.enum(DOCUMENT_GRANTEE_VALUES)

// Создание документа (метаданные; файлы прикрепляются отдельным multipart-эндпоинтом).
export const CreateDocumentSchema = z
  .object({
    category: DocumentCategorySchema,
    type: z.string().min(1).max(64), // проверяется по каталогу на сервере
    title: z.string().min(1).max(200),
    number: z.string().max(120).optional(),
    issuedBy: z.string().max(200).optional(),
    issuedAt: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    comment: z.string().max(2000).optional(),
    // DRAFT — сохранить черновик; UPLOADED — сразу «загружен» (по умолчанию). Прочие статусы ставит сервис/проверка.
    status: z.enum(['DRAFT', 'UPLOADED']).optional(),
  })
  .strict()
export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>

// Изменение данных документа (пустая строка/`null` очищает поле).
export const UpdateDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    number: z.string().max(120).optional().nullable(),
    issuedBy: z.string().max(200).optional().nullable(),
    issuedAt: z.coerce.date().optional().nullable(),
    expiresAt: z.coerce.date().optional().nullable(),
    comment: z.string().max(2000).optional().nullable(),
  })
  .strict()
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>

// Выдача доступа к документу (ТЗ §9). granteeId обязателен для DEPARTMENT/USER — проверяет сервис.
export const GrantDocumentAccessSchema = z
  .object({
    granteeType: DocumentGranteeSchema,
    granteeId: z.string().min(1).optional(),
    reason: z.string().min(1).max(300),
    expiresAt: z.coerce.date().optional().nullable(),
  })
  .strict()
export type GrantDocumentAccessInput = z.infer<typeof GrantDocumentAccessSchema>

// Порядок страниц при прикреплении файлов (лицо/оборот и т.д.).
export const ReorderDocumentFilesSchema = z
  .object({ fileIds: z.array(z.string().min(1)).min(1).max(30) })
  .strict()
export type ReorderDocumentFilesInput = z.infer<typeof ReorderDocumentFilesSchema>

// Список моих документов: фильтры/поиск/сортировка + вид (активные/архив).
export const DocumentListQuerySchema = z
  .object({
    category: DocumentCategorySchema.optional(),
    type: z.string().min(1).max(64).optional(),
    status: DocumentStatusSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    sort: z.enum(['new', 'old', 'expiring', 'title']).default('new'),
    view: z.enum(['active', 'archived']).default('active'),
  })
  .strict()
export type DocumentListQueryInput = z.infer<typeof DocumentListQuerySchema>

// Спец-режим платформенного админа (задача 15.21): доступ к содержимому чужого документа
// только с обязательной причиной; каждое обращение пишется в аудит и журнал документа.
export const PlatformDocumentAccessSchema = z
  .object({
    fileId: z.string().min(1),
    reason: z.string().min(5).max(500),
  })
  .strict()
export type PlatformDocumentAccessInput = z.infer<typeof PlatformDocumentAccessSchema>

// ── Под-фаза D: управление типами документов вузом (задача 15.20) ─────────────

// Поля мастера, которые можно назначить custom-типу (зеркалит DOCUMENT_FIELDS в shared-config).
export const DOCUMENT_FIELD_VALUES = [
  'number',
  'issuedAt',
  'expiresAt',
  'issuedBy',
  'comment',
] as const
export const DocumentFieldSchema = z.enum(DOCUMENT_FIELD_VALUES)

// Правка статического типа для вуза: включить/выключить + срок хранения (дни; null — снять).
export const UpdateDocumentTypeSchema = z
  .object({
    enabled: z.boolean().optional(),
    retentionDays: z.number().int().min(0).max(36500).optional().nullable(),
  })
  .strict()
export type UpdateDocumentTypeInput = z.infer<typeof UpdateDocumentTypeSchema>

// Добавление собственного (custom) типа вузом.
export const CreateCustomDocumentTypeSchema = z
  .object({
    code: z
      .string()
      .min(2)
      .max(48)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'Код: заглавные латинские, цифры, подчёркивание'),
    category: DocumentCategorySchema,
    label: z.string().min(1).max(120),
    fields: z.array(DocumentFieldSchema).max(5).optional(),
    retentionDays: z.number().int().min(0).max(36500).optional().nullable(),
  })
  .strict()
export type CreateCustomDocumentTypeInput = z.infer<typeof CreateCustomDocumentTypeSchema>

// ── Под-фаза C: запросы вуза (ТЗ §5, задачи 15.14–15.16) ──────────────────────

export const DOCUMENT_REQUEST_STATUS_VALUES = ['OPEN', 'CLOSED'] as const
export const DocumentRequestStatusSchema = z.enum(DOCUMENT_REQUEST_STATUS_VALUES)

export const DOCUMENT_REQUEST_TARGET_VALUES = ['UNIVERSITY', 'FACULTY', 'GROUP', 'USER'] as const
export const DocumentRequestTargetTypeSchema = z.enum(DOCUMENT_REQUEST_TARGET_VALUES)

export const DOCUMENT_SUBMISSION_STATUS_VALUES = [
  'DRAFT',
  'SUBMITTED',
  'PARTIAL',
  'ACCEPTED',
  'REJECTED',
] as const
export const DocumentSubmissionStatusSchema = z.enum(DOCUMENT_SUBMISSION_STATUS_VALUES)

export const DOCUMENT_SUBMISSION_ITEM_STATUS_VALUES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const
export const DocumentSubmissionItemStatusSchema = z.enum(DOCUMENT_SUBMISSION_ITEM_STATUS_VALUES)

// Требуемая позиция в запросе (тип из каталога проверяется на сервере).
export const CreateRequestItemSchema = z
  .object({
    documentType: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    required: z.boolean().optional(),
  })
  .strict()

// Адресат запроса. targetId обязателен для FACULTY/GROUP/USER — проверяет сервис.
export const CreateRequestTargetSchema = z
  .object({
    targetType: DocumentRequestTargetTypeSchema,
    targetId: z.string().min(1).optional(),
  })
  .strict()

// Создание запроса сотрудником (15.14).
export const CreateDocumentRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueAt: z.coerce.date().optional().nullable(),
    items: z.array(CreateRequestItemSchema).min(1).max(30),
    targets: z.array(CreateRequestTargetSchema).min(1).max(50),
  })
  .strict()
export type CreateDocumentRequestInput = z.infer<typeof CreateDocumentRequestSchema>

// Черновик ответа студента (15.15): привязка выбранных документов к позициям запроса.
export const SaveSubmissionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            requestItemId: z.string().min(1),
            documentId: z.string().min(1).nullable(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict()
export type SaveSubmissionInput = z.infer<typeof SaveSubmissionSchema>

// Проверка одной позиции ответа сотрудником (15.16). Причина обязательна при отклонении.
export const ReviewSubmissionItemSchema = z
  .object({
    status: z.enum(['ACCEPTED', 'REJECTED']),
    rejectionReason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => v.status !== 'REJECTED' || !!v.rejectionReason?.trim(), {
    message: 'rejectionReason required when rejecting',
    path: ['rejectionReason'],
  })
export type ReviewSubmissionItemInput = z.infer<typeof ReviewSubmissionItemSchema>
