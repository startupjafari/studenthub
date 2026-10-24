import { z } from 'zod'
import { OptionalCursorPaginationSchema, PageSchema, SortOrderSchema } from './pagination.js'

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

// Замена одной страницы: новый (уже загруженный, ещё не прикреплённый) файл встаёт на место
// старой страницы с тем же порядковым номером, старый файл удаляется из хранилища.
export const ReplaceDocumentFileSchema = z.object({ fileId: z.string().min(1) }).strict()
export type ReplaceDocumentFileInput = z.infer<typeof ReplaceDocumentFileSchema>

// Колонки таблицы документов, по которым разрешена сортировка. Именно колонки, а не
// пресеты «новые/старые»: таблица сортируется кликом по заголовку, и набор значений
// должен совпадать с тем, что видит пользователь. Номер сюда не входит — наружу уходит
// только маска ******4821, сортировать по ней бессмысленно.
export const DOCUMENT_SORT_FIELDS = [
  'title',
  'category',
  'status',
  'issuedAt',
  'expiresAt',
  'access',
  'createdAt',
] as const
export const DocumentSortSchema = z.enum(DOCUMENT_SORT_FIELDS)
export type DocumentSortValue = z.infer<typeof DocumentSortSchema>

// Список моих документов: фильтры/поиск/сортировка + вид (активные/архив).
// sort/order — по всей выборке, а не по открытой странице.
export const DocumentListQuerySchema = z
  .object({
    category: DocumentCategorySchema.optional(),
    type: z.string().min(1).max(64).optional(),
    status: DocumentStatusSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    sort: DocumentSortSchema.optional(),
    order: SortOrderSchema.optional(),
    // Пресет раздела: доступные мне по гранту и выданные вузом. Раньше отбирался
    // на клиенте — из-за этого счётчик строк врал: сервер отдавал одно число, таблица
    // показывала другое.
    preset: z.enum(['active', 'shared', 'issued']).optional(),
    view: z.enum(['active', 'archived']).default('active'),
    // Страница по запросу (как у комментариев): без `limit`/`cursor` — прежний ответ
    // массивом, его читают веб и Android; с ними — страница с meta.cursor/hasNext/total.
    // Без этих полей `.strict()` отвечал 400 iOS-клиенту, который шлёт `?limit=50`.
    ...OptionalCursorPaginationSchema.shape,
  })
  .strict()
export type DocumentListQueryInput = z.infer<typeof DocumentListQuerySchema>

// Потолок файлов в одном запросе спец-доступа. Документ — это скан на несколько страниц,
// а не медиатека; ограничение держит и размер аудит-записи, и число presigned-выдач.
export const PLATFORM_ACCESS_FILES_MAX = 50

// Спец-режим платформенного админа (задача 15.21): доступ к содержимому чужого документа
// только с обязательной причиной; каждое обращение пишется в аудит и журнал документа.
// Файлы запрашиваются пачкой: открытие карточки тянет превью всех сканов сразу, и по файлу
// на запрос журнал распухал на N строк вместо одной записи об одном обращении.
export const PlatformDocumentAccessSchema = z
  .object({
    fileIds: z.array(z.string().min(1)).min(1).max(PLATFORM_ACCESS_FILES_MAX),
    reason: z.string().min(5).max(500),
  })
  .strict()
export type PlatformDocumentAccessInput = z.infer<typeof PlatformDocumentAccessSchema>

// Метаданные чужого документа в спец-режиме — тоже с причиной (D-F24): карточка раскрывает
// тип, название, маску номера, даты и состав файлов, и обращение без обоснования в аудите
// было бы «тихим» доступом.
export const PlatformDocumentMetaSchema = z.object({ reason: z.string().min(5).max(500) }).strict()
export type PlatformDocumentMetaInput = z.infer<typeof PlatformDocumentMetaSchema>

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

// ── Прогресс группы по запросам документов — старосте (15.2/15.6) ────────────────

// Статус комплекта одногруппника глазами старосты: без документов, их типов, номеров и
// файлов. NOT_STARTED — комплекта нет, IN_PROGRESS — черновик, SUBMITTED — отправлен и
// ждёт проверки, NEEDS_FIX — возвращён на исправление, ACCEPTED — принят.
export const GROUP_PROGRESS_STATUS_VALUES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'NEEDS_FIX',
  'ACCEPTED',
] as const
export type GroupProgressStatus = (typeof GROUP_PROGRESS_STATUS_VALUES)[number]

// Запрос «учебный», если все его позиции — учебные документы (категория ACADEMIC): по
// нему староста видит одногруппников поимённо. Запрос с личными документами (паспорт,
// справки и т.п.) — только счётчики, и «возвращён на исправление» в них не выделяется:
// поимённый или отдельный счёт отказов по личным документам раскрывал бы, у кого из
// одногруппников проблемы с паспортом.
export interface GroupRequestProgress {
  id: string
  title: string
  dueAt: string | null
  acceptsSubmissions: boolean
  kind: 'ACADEMIC' | 'PERSONAL'
  counts: {
    total: number
    notSubmitted: number
    submitted: number
    // Только у учебных запросов; у личных такие комплекты входят в notSubmitted.
    needsFix: number | null
    accepted: number
  }
  // Только у учебных запросов; у личных — null.
  members: { id: string; name: string; status: GroupProgressStatus }[] | null
}

// ── Журнал документов вуза для админа вуза (15.2: «читает журнал», без содержимого) ──

// Действия журнала DocumentEvent, по которым можно фильтровать.
export const DOCUMENT_JOURNAL_ACTIONS = [
  'UPLOAD',
  'VIEW',
  'DOWNLOAD',
  'EDIT',
  'REPLACE',
  'PAGE_ADD',
  'PAGE_REMOVE',
  'GRANT',
  'REVOKE',
  'SUBMIT',
  'REVIEW',
  'ACCEPT',
  'REJECT',
  'ARCHIVE',
  'DELETE',
  'EXPIRING',
  'EXPIRE',
] as const
export const DocumentJournalActionSchema = z.enum(DOCUMENT_JOURNAL_ACTIONS)
export type DocumentJournalAction = z.infer<typeof DocumentJournalActionSchema>

// Админская таблица с номером страницы — offset допустим (BACKEND_RULES §5.3).
// `q` — ФИО того, кто действовал, или владельца документа; `userId` — точный человек в
// любой из двух ролей. Период — по дате события, `to` включительно (до конца дня — в вебе).
export const DocumentJournalQuerySchema = z
  .object({
    page: PageSchema,
    limit: z.coerce.number().int().positive().max(100).default(20),
    action: DocumentJournalActionSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    userId: z.string().min(1).max(64).optional(),
  })
  .strict()
export type DocumentJournalQueryInput = z.infer<typeof DocumentJournalQuerySchema>

// Через что совершено действие: свой документ, грант доступа, запрос вуза, заявка,
// спец-режим платформы или автоматика (крон срока).
export const DOCUMENT_JOURNAL_VIA = [
  'OWNER',
  'GRANT',
  'REQUEST',
  'APPLICATION',
  'PLATFORM',
  'SYSTEM',
  'STAFF',
] as const
export type DocumentJournalVia = (typeof DOCUMENT_JOURNAL_VIA)[number]

// Строка журнала. Только метаданные: ни названия, ни номера, ни файлов документа —
// тип и категория говорят, «что за документ», не раскрывая содержимого.
export interface DocumentJournalItem {
  id: string
  createdAt: string
  action: string
  actor: { id: string; name: string; role: string | null }
  owner: { id: string; name: string }
  document: { id: string; category: string; type: string; deleted: boolean }
  via: DocumentJournalVia
  // Для GRANT/REVOKE/VIEW по гранту — кому выдан доступ (UNIVERSITY | DEPARTMENT | USER).
  granteeType: string | null
  // Для событий по запросу вуза — его название.
  request: { id: string; title: string } | null
}
