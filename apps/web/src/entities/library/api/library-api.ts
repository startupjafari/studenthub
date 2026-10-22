import type {
  AddBookCopiesInput,
  BookCard,
  BookCopyByCode,
  BookCopyItem,
  BookCopyLabel,
  BookDetail,
  BookListQueryInput,
  CreateBookInput,
  IdAccessItem,
  InventoryReport,
  InventoryScanInput,
  InventoryScanResult,
  IdAccessQueryInput,
  IssueLoanInput,
  LibraryClearance,
  LibraryDebts,
  LibraryReaderSession,
  LibrarySummary,
  PopularBook,
  LoanItem,
  LoanListQueryInput,
  LoanReaderCard,
  RenewLoanInput,
  ReservationItem,
  ReservationListQueryInput,
  ReturnLoanInput,
  ReturnLoanResult,
  LibraryImportCommitInput,
  LibraryImportPreviewResponse,
  LibraryImportResult,
  LibrarySettingsResponse,
  UpdateBookCopyInput,
  UpdateBookInput,
  UpdateLibrarySettingsInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'

// Библиотека вуза (Фаза 20, docs/PROJECT.md §3.11). Ключи запросов — фабрика рядом с
// запросами, как у остальных сущностей.

/** Параметры каталога в запросе: булевы флаги уходят строками, как ждёт схема. */
export interface BookListParams {
  page?: number
  limit?: number
  q?: string
  section?: string
  available?: boolean
  archived?: boolean
  sort?: BookListQueryInput['sort']
  order?: BookListQueryInput['order']
}

export const libraryKeys = {
  all: ['library'] as const,
  settings: () => ['library', 'settings'] as const,
  books: (params: BookListParams = {}) => ['library', 'books', params] as const,
  book: (id: string) => ['library', 'book', id] as const,
  sections: () => ['library', 'sections'] as const,
  copyByCode: (code: string) => ['library', 'copy-by-code', code] as const,
  loans: (params: Partial<LoanListQueryInput> = {}) => ['library', 'loans', params] as const,
  myLoans: () => ['library', 'my-loans'] as const,
  loanReader: (id: string) => ['library', 'loan-reader', id] as const,
  reservations: (params: Partial<ReservationListQueryInput> = {}) =>
    ['library', 'reservations', params] as const,
  myReservations: () => ['library', 'my-reservations'] as const,
  debts: (userId: string) => ['library', 'debts', userId] as const,
  clearance: () => ['library', 'clearance'] as const,
  summary: () => ['library', 'summary'] as const,
  popular: (days: number) => ['library', 'popular', days] as const,
  inventory: (params: { since: string; page: number; limit: number }) =>
    ['library', 'inventory', params] as const,
  idAccess: (params: Partial<IdAccessQueryInput> = {}) => ['library', 'id-access', params] as const,
}

export async function fetchLibrarySettings(): Promise<LibrarySettingsResponse> {
  const { data } = await api.get<LibrarySettingsResponse>('/library/settings')
  return data
}

export async function updateLibrarySettingsRequest(
  input: UpdateLibrarySettingsInput,
): Promise<LibrarySettingsResponse> {
  const { data } = await api.patch<LibrarySettingsResponse>('/library/settings', input)
  return data
}

// ── Каталог ──────────────────────────────────────────────────────────────────────────

export async function fetchBooks(params: BookListParams = {}): Promise<Paged<BookCard>> {
  const { available, archived, ...rest } = params
  return getPaged<BookCard>('/library/books', {
    page: 1,
    limit: 20,
    ...rest,
    ...(available ? { available: 'true' } : {}),
    ...(archived ? { archived: 'true' } : {}),
  })
}

export async function fetchBook<T extends BookCard = BookCard>(id: string): Promise<T> {
  const { data } = await api.get<T>(`/library/books/${id}`)
  return data
}

export async function fetchBookSections(): Promise<string[]> {
  const { data } = await api.get<string[]>('/library/books/sections')
  return data
}

export async function createBookRequest(input: CreateBookInput): Promise<BookCard> {
  const { data } = await api.post<BookCard>('/library/books', input)
  return data
}

export async function updateBookRequest(id: string, input: UpdateBookInput): Promise<BookCard> {
  const { data } = await api.patch<BookCard>(`/library/books/${id}`, input)
  return data
}

export async function uploadBookCoverRequest(id: string, file: File): Promise<BookCard> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<BookCard>(`/library/books/${id}/cover`, form)
  return data
}

// ── Экземпляры ───────────────────────────────────────────────────────────────────────

export async function addBookCopiesRequest(
  bookId: string,
  input: AddBookCopiesInput,
): Promise<BookCopyItem[]> {
  const { data } = await api.post<BookCopyItem[]>(`/library/books/${bookId}/copies`, input)
  return data
}

export async function updateBookCopyRequest(
  id: string,
  input: UpdateBookCopyInput,
): Promise<BookCopyItem> {
  const { data } = await api.patch<BookCopyItem>(`/library/copies/${id}`, input)
  return data
}

export async function rotateBookCopyCodeRequest(id: string): Promise<BookCopyLabel> {
  const { data } = await api.post<BookCopyLabel>(`/library/copies/${id}/code/rotate`)
  return data
}

export async function bookCopyLabelsRequest(copyIds: string[]): Promise<BookCopyLabel[]> {
  const { data } = await api.post<BookCopyLabel[]>('/library/copies/labels', { copyIds })
  return data
}

export async function fetchBookCopyByCode(code: string): Promise<BookCopyByCode> {
  const { data } = await api.get<BookCopyByCode>(
    `/library/copies/by-code/${encodeURIComponent(code)}`,
  )
  return data
}

// ── Импорт фонда ─────────────────────────────────────────────────────────────────────

export async function libraryImportPreviewRequest(
  file: File,
): Promise<LibraryImportPreviewResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<LibraryImportPreviewResponse>('/library/import/preview', form)
  return data
}

export async function libraryImportCommitRequest(
  input: LibraryImportCommitInput,
): Promise<LibraryImportResult> {
  const { data } = await api.post<LibraryImportResult>('/library/import', input)
  return data
}

// ── Выдачи ───────────────────────────────────────────────────────────────────────────

export async function resolveReaderRequest(token: string): Promise<LibraryReaderSession> {
  const { data } = await api.post<LibraryReaderSession>('/library/readers/resolve', { token })
  return data
}

export async function issueLoanRequest(input: IssueLoanInput): Promise<LoanItem> {
  const { data } = await api.post<LoanItem>('/library/loans', input)
  return data
}

export async function fetchLoans(
  params: Partial<LoanListQueryInput> = {},
): Promise<Paged<LoanItem>> {
  return getPaged<LoanItem>('/library/loans', { page: 1, limit: 20, ...params })
}

export async function fetchMyLoans(): Promise<LoanItem[]> {
  const { data } = await api.get<LoanItem[]>('/library/me/loans')
  return data
}

export async function returnCopyRequest(input: ReturnLoanInput): Promise<ReturnLoanResult> {
  const { data } = await api.post<ReturnLoanResult>('/library/returns', input)
  return data
}

export async function renewLoanRequest(id: string, input: RenewLoanInput = {}): Promise<LoanItem> {
  const { data } = await api.post<LoanItem>(`/library/loans/${id}/renew`, input)
  return data
}

export async function markLoanLostRequest(id: string): Promise<LoanItem> {
  const { data } = await api.post<LoanItem>(`/library/loans/${id}/lost`)
  return data
}

export async function cancelLoanRequest(id: string, reason: string): Promise<LoanItem> {
  const { data } = await api.post<LoanItem>(`/library/loans/${id}/cancel`, { reason })
  return data
}

export async function disputeLoanRequest(id: string): Promise<LoanItem> {
  const { data } = await api.post<LoanItem>(`/library/loans/${id}/dispute`)
  return data
}

export type { BookCard, BookDetail, BookCopyItem, BookCopyLabel, LoanItem, LibraryReaderSession }

/** Удостоверение читателя по открытой выдаче — каждый вызов пишется в журнал. */
export async function fetchLoanReader(id: string): Promise<LoanReaderCard> {
  const { data } = await api.get<LoanReaderCard>(`/library/loans/${id}/reader`)
  return data
}

export async function fetchIdAccess(
  params: Partial<IdAccessQueryInput> = {},
): Promise<Paged<IdAccessItem>> {
  return getPaged<IdAccessItem>('/library/id-access', { page: 1, limit: 20, ...params })
}

export async function fetchReservations(
  params: Partial<ReservationListQueryInput> = {},
): Promise<Paged<ReservationItem>> {
  return getPaged<ReservationItem>('/library/reservations', { page: 1, limit: 20, ...params })
}

export async function cancelReservationRequest(id: string): Promise<ReservationItem> {
  const { data } = await api.post<ReservationItem>(`/library/reservations/${id}/cancel`)
  return data
}

export async function reserveBookRequest(bookId: string): Promise<ReservationItem> {
  const { data } = await api.post<ReservationItem>(`/library/books/${bookId}/reservations`)
  return data
}

export async function fetchMyReservations(): Promise<ReservationItem[]> {
  const { data } = await api.get<ReservationItem[]>('/library/me/reservations')
  return data
}

export async function cancelMyReservationRequest(id: string): Promise<ReservationItem> {
  const { data } = await api.post<ReservationItem>(`/library/me/reservations/${id}/cancel`)
  return data
}

/** Книги за студентом — декану и админу вуза при смене статуса (20.11). */
export async function fetchReaderDebts(userId: string): Promise<LibraryDebts> {
  const { data } = await api.get<LibraryDebts>(`/library/readers/${userId}/debts`)
  return data
}

export async function fetchClearance(): Promise<LibraryClearance> {
  const { data } = await api.get<LibraryClearance>('/library/me/clearance')
  return data
}

export async function fetchLibrarySummary(): Promise<LibrarySummary> {
  const { data } = await api.get<LibrarySummary>('/library/reports/summary')
  return data
}

export async function fetchPopularBooks(days: number): Promise<PopularBook[]> {
  const { data } = await api.get<PopularBook[]>('/library/reports/popular', { params: { days } })
  return data
}

export async function inventoryScanRequest(
  input: InventoryScanInput,
): Promise<InventoryScanResult> {
  const { data } = await api.post<InventoryScanResult>('/library/inventory/scan', input)
  return data
}

export async function fetchInventory(params: {
  since: string
  page: number
  limit: number
}): Promise<InventoryReport> {
  const { data } = await api.get<InventoryReport>('/library/inventory', { params })
  return data
}
