import type {
  AddBookCopiesInput,
  BookCard,
  BookCopyByCode,
  BookCopyItem,
  BookCopyLabel,
  BookDetail,
  BookListQueryInput,
  CreateBookInput,
  IssueLoanInput,
  LibraryReaderSession,
  LoanItem,
  LoanListQueryInput,
  RenewLoanInput,
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
