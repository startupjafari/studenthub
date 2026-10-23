import type { AxiosProgressEvent } from 'axios'
import type {
  CreateDocumentInput,
  DocumentListQueryInput,
  GrantDocumentAccessInput,
  UpdateDocumentInput,
} from '@studenthub/shared-schemas'
import {
  api,
  needsDirectUpload,
  uploadDirect,
  type PresignedTarget,
  type ResponseWithMeta,
} from '../../../shared/api'

export const documentKeys = {
  all: ['documents'] as const,
  list: (q: Partial<DocumentListQueryInput>) => ['documents', 'list', q] as const,
  overview: () => ['documents', 'overview'] as const,
  detail: (id: string) => ['documents', 'detail', id] as const,
  events: (id: string) => ['documents', id, 'events'] as const,
  access: (id: string) => ['documents', id, 'access'] as const,
  sharedWithMe: () => ['documents', 'shared-with-me'] as const,
}

export interface DocumentFile {
  id: string
  mime: string
  size: number
  order: number | null
}

// Документ. Полный номер бэкенд не отдаёт — только маска ******4821.
export interface DocumentDto {
  id: string
  category: string
  type: string
  title: string
  numberMasked: string | null
  issuedBy: string | null
  issuedAt: string | null
  expiresAt: string | null
  comment: string | null
  status: string
  rejectionReason: string | null
  issuedByUniversity: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  files: DocumentFile[]
  fileCount: number
  accessCount: number
}

export interface DocumentOverview {
  total: number
  toUpload: number
  inReview: number
  expiringSoon: number
  needsReplacement: number
}

export interface DocumentEvent {
  id: string
  documentId: string | null
  requestId: string | null
  actorId: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface UploadedDocFile {
  id: string
  mime: string
  size: number
}

export async function fetchDocuments(
  query: Partial<DocumentListQueryInput> = {},
): Promise<DocumentDto[]> {
  const { data } = await api.get<DocumentDto[]>('/documents', { params: query })
  return data
}

export async function fetchDocumentOverview(): Promise<DocumentOverview> {
  const { data } = await api.get<DocumentOverview>('/documents/overview')
  return data
}

export async function fetchDocument(id: string): Promise<DocumentDto> {
  const { data } = await api.get<DocumentDto>(`/documents/${id}`)
  return data
}

export async function fetchDocumentEvents(id: string): Promise<DocumentEvent[]> {
  const { data } = await api.get<DocumentEvent[]>(`/documents/${id}/events`)
  return data
}

/**
 * Загрузка файла документа. Путь выбирается по размеру: до порога — буферный (multipart
 * через api), больше — прямой в MinIO по подписанной ссылке. Скан диплома в 300 dpi
 * обычно перевешивает порог, и раньше такой файл загрузить было нельзя вовсе.
 */
export async function uploadDocumentFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadedDocFile> {
  if (needsDirectUpload(file.size)) {
    return uploadDirect<UploadedDocFile>({
      file,
      presign: async (mime) => {
        const { data } = await api.post<PresignedTarget>('/documents/upload/presign', { mime })
        return data
      },
      confirm: async (key, name) => {
        const { data } = await api.post<UploadedDocFile>('/documents/upload/confirm', {
          key,
          name,
        })
        return data
      },
      onProgress,
    })
  }

  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<UploadedDocFile>('/documents/upload', form, {
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}

export async function createDocument(input: CreateDocumentInput): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>('/documents', input)
  return data
}

export async function updateDocument(id: string, input: UpdateDocumentInput): Promise<DocumentDto> {
  const { data } = await api.patch<DocumentDto>(`/documents/${id}`, input)
  return data
}

export async function attachDocumentFiles(id: string, fileIds: string[]): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>(`/documents/${id}/files`, { fileIds })
  return data
}

export async function reorderDocumentFiles(id: string, fileIds: string[]): Promise<DocumentDto> {
  const { data } = await api.patch<DocumentDto>(`/documents/${id}/files/order`, { fileIds })
  return data
}

// Замена страницы: загруженный файл встаёт на место `fileId` с тем же порядком, старый
// сервер удаляет из хранилища.
export async function replaceDocumentFile(
  id: string,
  fileId: string,
  newFileId: string,
): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>(`/documents/${id}/files/${fileId}/replace`, {
    fileId: newFileId,
  })
  return data
}

// Удаление страницы (единственную сервер не удаляет — 400).
export async function removeDocumentFile(id: string, fileId: string): Promise<DocumentDto> {
  const { data } = await api.delete<DocumentDto>(`/documents/${id}/files/${fileId}`)
  return data
}

/**
 * Presigned-ссылка на файл документа.
 *
 * `download` — ссылка на скачивание: сервер подписывает в неё `Content-Disposition:
 * attachment`. Без этого скачать файл нельзя: объект лежит в MinIO, на другом origin,
 * а атрибут `download` у ссылки кросс-origin браузер игнорирует и просто открывает файл.
 */
export async function fetchDocumentFileUrl(
  id: string,
  fileId: string,
  download = false,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/documents/${id}/files/${fileId}/url`, {
    params: download ? { download: '1' } : undefined,
  })
  return data.url
}

export async function archiveDocument(id: string): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>(`/documents/${id}/archive`)
  return data
}

export async function unarchiveDocument(id: string): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>(`/documents/${id}/unarchive`)
  return data
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`)
}

// ── Управление доступом ──────────────────────────────────────────────────────

export interface DocumentAccessGrant {
  id: string
  granteeType: string
  granteeId: string | null
  reason: string
  grantedAt: string
  expiresAt: string | null
  revokedAt: string | null
  active: boolean
}

export async function fetchDocumentAccess(id: string): Promise<DocumentAccessGrant[]> {
  const { data } = await api.get<DocumentAccessGrant[]>(`/documents/${id}/access`)
  return data
}

export async function grantDocumentAccess(
  id: string,
  input: GrantDocumentAccessInput,
): Promise<DocumentAccessGrant[]> {
  const { data } = await api.post<DocumentAccessGrant[]>(`/documents/${id}/access`, input)
  return data
}

export async function revokeDocumentAccess(
  id: string,
  accessId: string,
): Promise<DocumentAccessGrant[]> {
  const { data } = await api.delete<DocumentAccessGrant[]>(`/documents/${id}/access/${accessId}`)
  return data
}

// ── Открытые мне (гранты на меня, мой факультет, мой вуз) ─────────────────────

// Документ, открытый смотрящему по гранту. Только метаданные с маской номера; файлы
// открываются той же ссылкой, что у владельца (`fetchDocumentFileUrl`) — сервер пускает
// по гранту и пишет просмотр в журнал документа.
export interface SharedDocument {
  accessId: string
  granteeType: string
  reason: string
  grantedAt: string
  expiresAt: string | null
  owner: { id: string; name: string }
  document: {
    id: string
    category: string
    type: string
    title: string
    numberMasked: string | null
    issuedBy: string | null
    issuedAt: string | null
    expiresAt: string | null
    status: string
    files: DocumentFile[]
    fileCount: number
  }
}

export interface SharedDocumentsPage {
  items: SharedDocument[]
  cursor?: string
  hasNext: boolean
}

export async function fetchSharedWithMe(cursor?: string): Promise<SharedDocumentsPage> {
  const res = (await api.get<SharedDocument[]>('/documents/shared-with-me', {
    params: { limit: 50, ...(cursor ? { cursor } : {}) },
  })) as ResponseWithMeta & { data: SharedDocument[] }
  return { items: res.data, cursor: res.meta?.cursor, hasNext: res.meta?.hasNext ?? false }
}

// ── Спец-режим платформенного админа (15.21) ──────────────────────────────────

// Причина уходит и с метаданными: карточка тоже раскрывает чужой документ, и обращение
// без обоснования в журнале спец-доступа было бы «тихим».
export async function fetchDocumentPlatform(id: string, reason: string): Promise<DocumentDto> {
  const { data } = await api.post<DocumentDto>(`/documents/${id}/platform`, { reason })
  return data
}

// Ссылки берём пачкой: одно обращение админа = одна строка в журнале спец-доступа.
// Запрос на файл давал по записи на каждое превью карточки.
export async function platformDocumentFileUrls(
  id: string,
  fileIds: string[],
  reason: string,
): Promise<Record<string, string>> {
  const { data } = await api.post<{ urls: Record<string, string> }>(
    `/documents/${id}/platform-access`,
    { fileIds, reason },
  )
  return data.urls
}
