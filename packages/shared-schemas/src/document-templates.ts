import { z } from 'zod'
import { PageSchema } from './pagination.js'

// DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»).
// Реестр переменных — в @studenthub/shared-config (DOCUMENT_TEMPLATE_VARIABLES); здесь —
// контракт API. Значения enum зеркалят shared-config, как в «Документах»: shared-schemas
// остаётся без зависимости от shared-config.

export const DOCUMENT_TEMPLATE_STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export const DocumentTemplateStatusSchema = z.enum(DOCUMENT_TEMPLATE_STATUS_VALUES)
export type DocumentTemplateStatus = z.infer<typeof DocumentTemplateStatusSchema>

/** Вид документа — для группировки в списке; на генерацию не влияет. */
export const DOCUMENT_TEMPLATE_CATEGORY_VALUES = [
  'CERTIFICATE', // справка
  'APPLICATION', // заявление
  'ORDER', // приказ
  'CONTRACT', // договор
  'CLEARANCE', // обходной лист
  'DORMITORY', // общежитие
  'OTHER',
] as const
export const DocumentTemplateCategorySchema = z.enum(DOCUMENT_TEMPLATE_CATEGORY_VALUES)
export type DocumentTemplateCategory = z.infer<typeof DocumentTemplateCategorySchema>

export const DOCUMENT_TEMPLATE_LOCALE_VALUES = ['ru', 'kk', 'en'] as const
export const DocumentTemplateLocaleSchema = z.enum(DOCUMENT_TEMPLATE_LOCALE_VALUES)

const title = z.string().trim().min(1).max(200)
const description = z.string().trim().max(1000)

export const CreateDocumentTemplateSchema = z
  .object({
    title,
    category: DocumentTemplateCategorySchema,
    description: description.optional(),
    locale: DocumentTemplateLocaleSchema.default('ru'),
  })
  .strict()
export type CreateDocumentTemplateInput = z.infer<typeof CreateDocumentTemplateSchema>

/** Правка метаданных. Пустое описание очищает поле. */
export const UpdateDocumentTemplateSchema = z
  .object({
    title: title.optional(),
    category: DocumentTemplateCategorySchema.optional(),
    description: description.nullable().optional(),
    locale: DocumentTemplateLocaleSchema.optional(),
  })
  .strict()
export type UpdateDocumentTemplateInput = z.infer<typeof UpdateDocumentTemplateSchema>

export const DocumentTemplateListQuerySchema = z
  .object({
    page: PageSchema,
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: DocumentTemplateStatusSchema.optional(),
    category: DocumentTemplateCategorySchema.optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict()
export type DocumentTemplateListQueryInput = z.infer<typeof DocumentTemplateListQuerySchema>

/**
 * Документ для конкретного студента. Только id: данные берутся из профиля на сервере,
 * значения с клиента шаблонизатор не получает никогда.
 */
export const GenerateDocumentFromTemplateSchema = z
  .object({ studentId: z.string().uuid() })
  .strict()
export type GenerateDocumentFromTemplateInput = z.infer<typeof GenerateDocumentFromTemplateSchema>

/** Проверочный документ: по умолчанию — по рабочей (последней загруженной) версии. */
export const DocumentTemplateTestQuerySchema = z
  .object({ versionId: z.string().uuid().optional() })
  .strict()
export type DocumentTemplateTestQueryInput = z.infer<typeof DocumentTemplateTestQuerySchema>

// ── Ответы ────────────────────────────────────────────────────────────────────

/**
 * Что нашла проверка шаблона. Ошибки (`errors`) запрещают публикацию и генерацию,
 * предупреждения (`warnings`) — нет. Текст для человека строит клиент по `code`.
 */
export const DOCUMENT_TEMPLATE_ISSUE_CODES = [
  'SYNTAX', // нарушены фигурные скобки
  'UNKNOWN_VARIABLE', // ключа нет в реестре
  'UNSUPPORTED_TAG', // цикл, условие, вставка XML — в MVP только простые поля
  'TOO_MANY_TAGS',
  'NO_VARIABLES', // предупреждение: в документе нет ни одной переменной
  'OPTIONAL_VARIABLE', // предупреждение: поле может оказаться пустым (отчество)
  'PERSONAL_DATA', // предупреждение: шаблон подставляет персональные данные
  'MORE_ISSUES', // ошибок больше, чем показано; в `tag` — сколько ещё
] as const
export type DocumentTemplateIssueCode = (typeof DOCUMENT_TEMPLATE_ISSUE_CODES)[number]

export interface DocumentTemplateIssue {
  code: DocumentTemplateIssueCode
  /** Переменная или фрагмент тега, к которому относится замечание. */
  tag?: string
  /** Часть документа: основной текст, колонтитул, сноски. */
  part?: 'body' | 'header' | 'footer' | 'other'
}

export interface DocumentTemplateValidation {
  valid: boolean
  /** Найденные переменные реестра, без повторов, в порядке появления. */
  variables: string[]
  errors: DocumentTemplateIssue[]
  warnings: DocumentTemplateIssue[]
}

/**
 * Почему файл не принят вовсе (а не сохранён с замечаниями): содержимое не годится в
 * шаблон независимо от переменных. Приходит в `details[].message` ошибки
 * `TEMPLATE_FILE_INVALID`.
 */
export const DOCUMENT_TEMPLATE_FILE_PROBLEMS = [
  'CORRUPTED', // архив не читается
  'NOT_WORD_DOCUMENT', // zip, но не документ Word (.docx)
  'MACROS', // макросы (.docm внутри)
  'ACTIVE_CONTENT', // ActiveX, OLE-объекты
  'EXTERNAL_CONTENT', // ссылки на внешние шаблоны и вложенные документы
  'ENCRYPTED', // зашифрованные части
  'TOO_COMPLEX', // распакованный объём, число частей или степень сжатия сверх пределов
] as const
export type DocumentTemplateFileProblem = (typeof DOCUMENT_TEMPLATE_FILE_PROBLEMS)[number]

export interface DocumentTemplatePerson {
  id: string
  name: string
}

export interface DocumentTemplateVersionDto {
  id: string
  version: number
  fileName: string | null
  size: number
  /** SHA-256 исходного DOCX: по нему сверяют, тот ли файл опубликован. */
  checksum: string
  createdAt: string
  createdBy: DocumentTemplatePerson | null
  validation: DocumentTemplateValidation
}

export interface DocumentTemplateListItem {
  id: string
  title: string
  category: DocumentTemplateCategory
  description: string | null
  locale: (typeof DOCUMENT_TEMPLATE_LOCALE_VALUES)[number]
  status: DocumentTemplateStatus
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  author: DocumentTemplatePerson | null
  /** Число переменных в рабочей (последней загруженной) версии. */
  variableCount: number
  currentVersion: { id: string; version: number; valid: boolean } | null
  publishedVersion: { id: string; version: number } | null
  /** Рабочая версия новее опубликованной — изменения ещё не видны при генерации. */
  hasUnpublishedChanges: boolean
}

export interface DocumentTemplateDetail extends DocumentTemplateListItem {
  versions: DocumentTemplateVersionDto[]
  /** Сколько документов уже сформировано по шаблону (для студентов, без проверочных). */
  generationCount: number
}
