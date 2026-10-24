import { z } from 'zod'
import { PageSchema } from './pagination.js'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11): каталог, экземпляры, выдачи, брони.
// Книги берут студенты и старосты своего вуза, выдаёт и принимает библиотекарь, модуль и
// правила выдачи настраивает админ вуза.

// ── Настройки модуля ─────────────────────────────────────────────────────────────────

/** Пределы правил выдачи: что админ вуза вообще может выставить. */
export const LIBRARY_LIMITS = {
  loanDays: { min: 1, max: 365 },
  activeLoans: { min: 1, max: 50 },
  activeReservations: { min: 0, max: 20 },
  holdDays: { min: 1, max: 30 },
  renewals: { min: 0, max: 10 },
} as const

const intIn = (range: { min: number; max: number }) =>
  z.number().int().min(range.min).max(range.max)

/**
 * Правка настроек библиотеки вуза. Любое поле можно не присылать — останется прежним.
 * Срок по умолчанию не может быть больше максимального: иначе каждая выдача «по умолчанию»
 * упиралась бы в отказ.
 */
export const UpdateLibrarySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultLoanDays: intIn(LIBRARY_LIMITS.loanDays).optional(),
    maxLoanDays: intIn(LIBRARY_LIMITS.loanDays).optional(),
    maxActiveLoans: intIn(LIBRARY_LIMITS.activeLoans).optional(),
    maxActiveReservations: intIn(LIBRARY_LIMITS.activeReservations).optional(),
    reservationHoldDays: intIn(LIBRARY_LIMITS.holdDays).optional(),
    maxRenewals: intIn(LIBRARY_LIMITS.renewals).optional(),
  })
  .strict()
export type UpdateLibrarySettingsInput = z.infer<typeof UpdateLibrarySettingsSchema>

export interface LibrarySettingsResponse {
  enabled: boolean
  defaultLoanDays: number
  maxLoanDays: number
  maxActiveLoans: number
  maxActiveReservations: number
  reservationHoldDays: number
  maxRenewals: number
  updatedAt: string | null
}

// ── Каталог и экземпляры (20.3) ──────────────────────────────────────────────────────

export const BOOK_COPY_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'ON_LOAN',
  'LOST',
  'WRITTEN_OFF',
] as const
export const BookCopyStatusSchema = z.enum(BOOK_COPY_STATUSES)
export type BookCopyStatusValue = z.infer<typeof BookCopyStatusSchema>

export const BOOK_CONDITIONS = ['GOOD', 'WORN', 'DAMAGED'] as const
export const BookConditionSchema = z.enum(BOOK_CONDITIONS)
export type BookConditionValue = z.infer<typeof BookConditionSchema>

/** Экземпляров за раз: заведение, наклейки, импорт одной строки. */
export const LIBRARY_COPIES_MAX = 200
/** Строк в одном файле импорта фонда. */
export const LIBRARY_IMPORT_MAX_ROWS = 1000

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

/**
 * ISBN-10 или ISBN-13: дефисы и пробелы убираются, «x» становится «X». Контрольную сумму
 * не проверяем: в фондах вузов полно старых изданий с опечатками в ISBN, и отказ из-за
 * неё мешал бы завести книгу, которая реально стоит на полке.
 */
export const IsbnSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .refine((v) => /^(\d{9}[\dX]|\d{13})$/.test(v), 'ISBN — 10 или 13 цифр')

const currentYearPlusOne = new Date().getFullYear() + 1

/** Инвентарный номер — как он написан в книге и в инвентарной книге фонда. */
export const InventoryNumberSchema = z.string().trim().min(1).max(40)

const bookFields = {
  title: z.string().trim().min(1).max(300),
  authors: z.string().trim().max(300).default(''),
  isbn: IsbnSchema.optional(),
  publisher: optionalText(200),
  year: z.number().int().min(1450).max(currentYearPlusOne).optional(),
  section: optionalText(100),
  description: optionalText(2000),
}

export const CreateBookSchema = z.object(bookFields).strict()
export type CreateBookInput = z.infer<typeof CreateBookSchema>

/** Правка карточки. `null` очищает необязательное поле; `archived` убирает книгу из каталога. */
export const UpdateBookSchema = z
  .object({
    title: bookFields.title.optional(),
    authors: z.string().trim().max(300).optional(),
    isbn: IsbnSchema.nullable().optional(),
    publisher: z.string().trim().max(200).nullable().optional(),
    year: bookFields.year.nullable(),
    section: z.string().trim().max(100).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    coverFileId: z.string().min(1).nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
export type UpdateBookInput = z.infer<typeof UpdateBookSchema>

export const BOOK_SORT_FIELDS = ['title', 'authors', 'year', 'createdAt'] as const
export const BookSortSchema = z.enum(BOOK_SORT_FIELDS)

/**
 * Поиск по каталогу. `q` ищет в названии, авторах и ISBN. `available` — только книги, у
 * которых есть экземпляр на полке. `archived` видят только те, кто ведёт фонд.
 */
export const BookListQuerySchema = z.object({
  page: PageSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().trim().max(100).optional(),
  section: z.string().trim().max(100).optional(),
  available: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: BookSortSchema.optional(),
  order: z.enum(['asc', 'desc']).optional(),
})
export type BookListQueryInput = z.infer<typeof BookListQuerySchema>

/**
 * Новые экземпляры книги: либо инвентарные номера списком, либо количество — тогда номера
 * выдаются подряд после наибольшего числового номера вуза.
 */
export const AddBookCopiesSchema = z
  .object({
    inventoryNumbers: z.array(InventoryNumberSchema).min(1).max(LIBRARY_COPIES_MAX).optional(),
    count: z.number().int().min(1).max(LIBRARY_COPIES_MAX).optional(),
    condition: BookConditionSchema.default('GOOD'),
  })
  .strict()
  .refine((v) => (v.inventoryNumbers ? 1 : 0) + (v.count ? 1 : 0) === 1, {
    message: 'Укажите инвентарные номера или количество',
    path: ['count'],
  })
export type AddBookCopiesInput = z.infer<typeof AddBookCopiesSchema>

/**
 * Правка экземпляра. Статус вручную — только вывод из оборота (утерян, списан) и возврат на
 * полку из них; выдачу и бронь двигают сами выдачи и брони.
 */
export const UpdateBookCopySchema = z
  .object({
    inventoryNumber: InventoryNumberSchema.optional(),
    condition: BookConditionSchema.optional(),
    note: z.string().trim().max(500).nullable().optional(),
    status: z.enum(['AVAILABLE', 'LOST', 'WRITTEN_OFF']).optional(),
  })
  .strict()
export type UpdateBookCopyInput = z.infer<typeof UpdateBookCopySchema>

/** Печать QR-наклеек экземпляров. */
export const BookCopyLabelsSchema = z
  .object({ copyIds: z.array(z.string().min(1)).min(1).max(LIBRARY_COPIES_MAX) })
  .strict()
export type BookCopyLabelsInput = z.infer<typeof BookCopyLabelsSchema>

/** Сколько экземпляров книги в каком состоянии. */
export interface BookAvailability {
  total: number
  available: number
  onLoan: number
  reserved: number
}

export interface BookCard {
  id: string
  title: string
  authors: string
  isbn: string | null
  publisher: string | null
  year: number | null
  section: string | null
  description: string | null
  coverUrl: string | null
  archived: boolean
  availability: BookAvailability
}

export interface BookCopyItem {
  id: string
  inventoryNumber: string
  code: string
  status: BookCopyStatusValue
  condition: BookConditionValue
  note: string | null
  inventoriedAt: string | null
  /** Кому выдан сейчас — только тем, кто ведёт фонд. */
  loan: { id: string; readerName: string; readerGroup: string | null; dueAt: string } | null
}

/** Книга с экземплярами — для тех, кто ведёт фонд. */
export interface BookDetail extends BookCard {
  copies: BookCopyItem[]
}

/** Наклейка экземпляра: что напечатать рядом с QR. */
export interface BookCopyLabel {
  copyId: string
  inventoryNumber: string
  code: string
  title: string
  authors: string
  university: string
  url: string
  qr: string
}

/** Экземпляр по коду с наклейки — для сканера библиотекаря. */
export interface BookCopyByCode {
  copy: BookCopyItem
  book: BookCard
}

// ── Импорт фонда из CSV/XLSX ─────────────────────────────────────────────────────────

export const LibraryImportRowStatusSchema = z.enum(['READY', 'DUPLICATE', 'ERROR'])

/**
 * Строка импорта: книга и её экземпляры — инвентарные номера через запятую или количество.
 * `DUPLICATE` — такой инвентарный номер уже есть в вузе или повторяется в файле.
 */
export interface LibraryImportPreviewRow {
  line: number
  title: string
  authors: string
  isbn: string | null
  publisher: string | null
  year: number | null
  section: string | null
  inventoryNumbers: string[]
  count: number
  status: z.infer<typeof LibraryImportRowStatusSchema>
  error: string | null
}

export interface LibraryImportPreviewResponse {
  rows: LibraryImportPreviewRow[]
  summary: { total: number; ready: number; duplicate: number; error: number; copies: number }
}

export const LibraryImportCommitRowSchema = z
  .object({
    line: z.number().int().positive(),
    title: bookFields.title,
    authors: bookFields.authors,
    isbn: IsbnSchema.nullable().optional(),
    publisher: z.string().trim().max(200).nullable().optional(),
    year: bookFields.year.nullable(),
    section: z.string().trim().max(100).nullable().optional(),
    inventoryNumbers: z.array(InventoryNumberSchema).max(LIBRARY_COPIES_MAX).default([]),
    count: z.number().int().min(0).max(LIBRARY_COPIES_MAX).default(0),
  })
  .strict()

export const LibraryImportCommitSchema = z
  .object({ rows: z.array(LibraryImportCommitRowSchema).min(1).max(LIBRARY_IMPORT_MAX_ROWS) })
  .strict()
export type LibraryImportCommitInput = z.infer<typeof LibraryImportCommitSchema>

export interface LibraryImportResult {
  books: number
  matched: number
  copies: number
  skipped: number
}

// ── Выдачи (20.4–20.6) ───────────────────────────────────────────────────────────────

/** Дата «YYYY-MM-DD»: срок выдачи — до конца этого дня по часам вуза. */
export const LibraryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')

/** Сканер студенческого отдал токен из QR — сервер сверяет читателя и выдаёт пропуск. */
export const ResolveReaderSchema = z.object({ token: z.string().min(1).max(2048) }).strict()
export type ResolveReaderInput = z.infer<typeof ResolveReaderSchema>

/** Экземпляр — по коду наклейки или по инвентарному номеру (наклейка стёрлась). */
const copyRef = {
  copyCode: z.string().trim().min(1).max(20).optional(),
  inventoryNumber: InventoryNumberSchema.optional(),
}
const oneCopyRef = (v: { copyCode?: string; inventoryNumber?: string }) =>
  (v.copyCode ? 1 : 0) + (v.inventoryNumber ? 1 : 0) === 1

export const IssueLoanSchema = z
  .object({
    /** Пропуск читателя из `POST /library/readers/resolve`. */
    ticket: z.string().min(1).max(2048),
    ...copyRef,
    /** Не указан — срок по умолчанию из правил вуза. */
    dueDate: LibraryDateSchema.optional(),
  })
  .strict()
  .refine(oneCopyRef, { message: 'Укажите код наклейки или инвентарный номер', path: ['copyCode'] })
export type IssueLoanInput = z.infer<typeof IssueLoanSchema>

/** Возврат — сканом экземпляра: какая выдача открыта, сервер знает сам. */
export const ReturnLoanSchema = z
  .object({ ...copyRef, condition: BookConditionSchema.default('GOOD') })
  .strict()
  .refine(oneCopyRef, { message: 'Укажите код наклейки или инвентарный номер', path: ['copyCode'] })
export type ReturnLoanInput = z.infer<typeof ReturnLoanSchema>

/** Продление: новая дата или, без неё, срок по умолчанию от текущего срока. */
export const RenewLoanSchema = z.object({ dueDate: LibraryDateSchema.optional() }).strict()
export type RenewLoanInput = z.infer<typeof RenewLoanSchema>

/** Отмена ошибочной выдачи — с причиной: выдачи не правятся задним числом. */
export const CancelLoanSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict()
export type CancelLoanInput = z.infer<typeof CancelLoanSchema>

/** Отмена ошибочного возврата — тоже с причиной, тело как у отмены выдачи. */
export const CancelReturnSchema = CancelLoanSchema
export type CancelReturnInput = CancelLoanInput

/**
 * Сколько часов после возврата его можно отменить. Ошибочный приём (отсканировали не ту
 * наклейку, приняли чужую книгу) замечают у стойки или на следующей смене — суток хватает.
 * Дальше отмена правила бы уже сложившуюся картину: экземпляр мог побывать на полке, в
 * инвентаризации, у читателя в руках, — такое оформляют обычной выдачей, а не откатом.
 */
export const LIBRARY_RETURN_CANCEL_HOURS = 24

export const LOAN_STATUSES = ['OPEN', 'RETURNED', 'LOST', 'CANCELLED'] as const
export const LoanStatusSchema = z.enum(LOAN_STATUSES)
export type LoanStatusValue = z.infer<typeof LoanStatusSchema>

/**
 * Фильтр выдач: на руках, просроченные (на руках со вчерашним сроком), утерянные с
 * непогашенным долгом, закрытые, все.
 */
export const LOAN_FILTERS = ['open', 'overdue', 'lost', 'closed', 'all'] as const
export const LoanListQuerySchema = z.object({
  page: PageSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
  filter: z.enum(LOAN_FILTERS).default('open'),
  q: z.string().trim().max(100).optional(),
  readerId: z.string().min(1).optional(),
  copyId: z.string().min(1).optional(),
})
export type LoanListQueryInput = z.infer<typeof LoanListQuerySchema>

/** Почему читателю сейчас не выдать книгу: `lost` — утерянная книга, долг не погашен. */
export const READER_BLOCKERS = ['status', 'limit', 'overdue', 'lost'] as const
export type ReaderBlocker = (typeof READER_BLOCKERS)[number]

/** Читатель глазами библиотеки: узкая карточка, как у охраны (без даты рождения и т. п.). */
export interface LibraryReader {
  id: string
  firstName: string
  lastName: string
  middleName: string | null
  avatarUrl: string | null
  group: string | null
  faculty: string | null
  studentCardNumber: string | null
  academicStatus: string | null
  course: number | null
}

export interface ReaderEligibility {
  canBorrow: boolean
  activeLoans: number
  maxActiveLoans: number
  overdueLoans: number
  /** Утерянные книги с непогашенным долгом. */
  lostLoans: number
  blockers: ReaderBlocker[]
}

export interface LoanItem {
  id: string
  status: LoanStatusValue
  issuedAt: string
  dueAt: string
  /** Последний день срока «YYYY-MM-DD» по часам вуза — его и показывать. */
  dueDate: string
  overdue: boolean
  renewals: number
  returnedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  disputedAt: string | null
  /**
   * Когда погашен долг по утерянной книге (заменили или возместили). У `LOST` без отметки —
   * `null`: такая выдача — долг читателя, как просрочка.
   */
  lostSettledAt: string | null
  book: { id: string; title: string; authors: string; coverUrl: string | null }
  copy: { id: string; inventoryNumber: string }
  reader: { id: string | null; name: string; group: string | null; card: string | null }
  issuedBy: string | null
}

/** Ответ сканера студенческого: читатель, может ли он брать книги, его выдачи и пропуск. */
export interface LibraryReaderSession {
  reader: LibraryReader
  eligibility: ReaderEligibility
  /** Пропуск на выдачу этому читателю — живёт дольше двухминутного QR студенческого. */
  ticket: string
  ticketExpiresAt: string
  loans: LoanItem[]
  defaultDueDate: string
  maxDueDate: string
}

/** Возврат принят: выдача и — если на книгу была очередь — кому отложить экземпляр. */
export interface ReturnLoanResult {
  loan: LoanItem
  /** Экземпляр отложен под бронь: положить на полку броней с этим именем. */
  heldFor: { name: string; group: string | null; holdUntil: string } | null
}

// ── Удостоверение читателя на время выдачи (20.6) ──────────────────────────────────

/**
 * Карточка читателя по открытой выдаче: библиотекарь сверяет, у кого книга, пока она на
 * руках. Набор узкий, как у охраны; после возврата карточка закрывается (`403`).
 */
export interface LoanReaderCard {
  reader: LibraryReader
  loan: {
    id: string
    bookTitle: string
    inventoryNumber: string
    issuedAt: string
    dueDate: string
  }
  viewedAt: string
}

/** Журнал просмотров удостоверений: кто, чьё, по какой выдаче, когда, с какого адреса. */
export const IdAccessQuerySchema = z.object({
  page: PageSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().trim().max(100).optional(),
  readerId: z.string().min(1).optional(),
  loanId: z.string().min(1).optional(),
})
export type IdAccessQueryInput = z.infer<typeof IdAccessQuerySchema>

export interface IdAccessItem {
  id: string
  createdAt: string
  librarianName: string
  readerId: string | null
  readerName: string
  loanId: string | null
  bookTitle: string | null
  ip: string | null
}

// ── Брони (20.8) ───────────────────────────────────────────────────────────────────

export const RESERVATION_STATUSES = [
  'QUEUED',
  'READY',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
] as const
export const ReservationStatusSchema = z.enum(RESERVATION_STATUSES)
export type ReservationStatusValue = z.infer<typeof ReservationStatusSchema>

/** Фильтр броней у библиотекаря: действующие, готовые (полка броней), в очереди, закрытые. */
export const RESERVATION_FILTERS = ['active', 'ready', 'queued', 'closed', 'all'] as const
export const ReservationListQuerySchema = z.object({
  page: PageSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
  filter: z.enum(RESERVATION_FILTERS).default('active'),
  q: z.string().trim().max(100).optional(),
  bookId: z.string().min(1).optional(),
})
export type ReservationListQueryInput = z.infer<typeof ReservationListQuerySchema>

export interface ReservationItem {
  id: string
  status: ReservationStatusValue
  createdAt: string
  readyAt: string | null
  /** До какого момента держится готовая бронь, и тот же день «ГГГГ-ММ-ДД» по часам вуза. */
  holdUntil: string | null
  holdDate: string | null
  closedAt: string | null
  /** Место в очереди (1 — следующий) — только у брони в очереди. */
  position: number | null
  book: { id: string; title: string; authors: string; coverUrl: string | null }
  /** Отложенный экземпляр — у готовой брони. */
  copy: { id: string; inventoryNumber: string } | null
  reader: { id: string; name: string; group: string | null }
}

// ── Долги при выпуске и отчислении, справка (20.11) ─────────────────────────────────

/** Книги за студентом — декану и админу вуза при смене статуса, библиотекарю. */
export interface LibraryDebts {
  readerId: string
  readerName: string
  /** Библиотека вуза включена; выключена — долги всё равно показываются, если остались. */
  enabled: boolean
  /** Ни одной книги на руках и ни одной утерянной с непогашенным долгом. */
  clear: boolean
  /** Долги: открытые выдачи и утерянные непогашенные. */
  loans: LoanItem[]
  activeReservations: number
}

/** Справка «задолженностей в библиотеке нет» — студенту, на момент запроса. */
export interface LibraryClearance {
  /** Долгов нет: ни книг на руках, ни утерянных с непогашенным долгом. */
  clear: boolean
  checkedAt: string
  reader: {
    name: string
    group: string | null
    faculty: string | null
    studentCardNumber: string | null
  }
  university: string
  loans: LoanItem[]
}

// ── Отчёты и инвентаризация (20.12) ────────────────────────────────────────────────

/** Сводка фонда и выдач — библиотекарю и админу вуза. */
export interface LibrarySummary {
  books: number
  copies: {
    total: number
    available: number
    onLoan: number
    reserved: number
    lost: number
    writtenOff: number
  }
  loans: { open: number; overdue: number; issuedLast30: number; returnedLast30: number }
  readers: { withLoans: number; debtors: number }
  reservations: { queued: number; ready: number }
}

export const POPULAR_PERIODS = [30, 90, 365] as const
export const PopularQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine(
      (v) => (POPULAR_PERIODS as readonly number[]).includes(v),
      'Период: 30, 90 или 365 дней',
    )
    .default(90),
})
export type PopularQueryInput = z.infer<typeof PopularQuerySchema>

/** Популярное за период: сколько раз книгу выдавали (отменённые выдачи не считаются). */
export interface PopularBook {
  book: { id: string; title: string; authors: string; coverUrl: string | null }
  loans: number
}

/** Скан экземпляра при инвентаризации: «экземпляр на месте» — отметка `inventoriedAt`. */
export const InventoryScanSchema = z
  .object({
    ...copyRef,
    /** Начало инвентаризации: отмеченный с этого дня экземпляр — «уже был». */
    since: LibraryDateSchema.optional(),
  })
  .strict()
  .refine(oneCopyRef, { message: 'Укажите код наклейки или инвентарный номер', path: ['copyCode'] })
export type InventoryScanInput = z.infer<typeof InventoryScanSchema>

/** Чем экземпляр в руках не похож на «стоит на полке» — повод разобраться. */
export const INVENTORY_WARNINGS = ['onLoan', 'lost', 'writtenOff'] as const
export type InventoryWarning = (typeof INVENTORY_WARNINGS)[number]

export interface InventoryScanResult {
  copy: { id: string; inventoryNumber: string; status: BookCopyStatusValue }
  book: { id: string; title: string; authors: string }
  /** Экземпляр уже отмечали в этой инвентаризации (с `since`). */
  alreadyChecked: boolean
  warning: InventoryWarning | null
}

/** Ход инвентаризации с даты `since`: что отмечено и что из «должно быть на полке» не нашли. */
export const InventoryQuerySchema = z.object({
  since: LibraryDateSchema,
  page: PageSchema,
  limit: z.coerce.number().int().positive().max(100).default(20),
})
export type InventoryQueryInput = z.infer<typeof InventoryQuerySchema>

export interface InventoryMissingItem {
  copyId: string
  inventoryNumber: string
  status: BookCopyStatusValue
  inventoriedAt: string | null
  book: { id: string; title: string; authors: string }
}

export interface InventoryReport {
  since: string
  /** Экземпляры, которые должны быть в библиотеке (на полке или под бронью). */
  expected: number
  /** Из них отмечены с `since`. */
  checked: number
  /** На руках у читателей — их не ищут на полке. */
  onLoan: number
  items: InventoryMissingItem[]
  total: number
  page: number
  limit: number
}
