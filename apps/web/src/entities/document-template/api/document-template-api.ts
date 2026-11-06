import type { AxiosProgressEvent } from 'axios'
import type {
  CreateDocumentTemplateInput,
  DocumentTemplateDetail,
  DocumentTemplateListItem,
  DocumentTemplateListQueryInput,
  UpdateDocumentTemplateInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import { requestFile, type DownloadedFile } from '../../../shared/lib'

// DOCX-шаблоны документов вуза (docs/PROJECT.md §3.8 «Шаблоны документов»). Вуз сервер берёт
// из токена; управление — админ вуза.

export type DocumentTemplateListParams = Partial<DocumentTemplateListQueryInput>

export const documentTemplateKeys = {
  all: ['document-templates'] as const,
  list: (params: DocumentTemplateListParams) => ['document-templates', 'list', params] as const,
  detail: (id: string) => ['document-templates', 'detail', id] as const,
}

export function fetchDocumentTemplates(
  params: DocumentTemplateListParams,
): Promise<Paged<DocumentTemplateListItem>> {
  return getPaged<DocumentTemplateListItem>('/document-templates', { ...params })
}

export async function fetchDocumentTemplate(id: string): Promise<DocumentTemplateDetail> {
  const { data } = await api.get<DocumentTemplateDetail>(`/document-templates/${id}`)
  return data
}

export async function createDocumentTemplate(
  input: CreateDocumentTemplateInput,
): Promise<DocumentTemplateDetail> {
  const { data } = await api.post<DocumentTemplateDetail>('/document-templates', input)
  return data
}

export async function updateDocumentTemplate(
  id: string,
  input: UpdateDocumentTemplateInput,
): Promise<DocumentTemplateDetail> {
  const { data } = await api.patch<DocumentTemplateDetail>(`/document-templates/${id}`, input)
  return data
}

/** Удаление; `archived: true` — по шаблону уже выдавали документы, он ушёл в архив. */
export async function deleteDocumentTemplate(id: string): Promise<{ archived: boolean }> {
  const { data } = await api.delete<{ archived: boolean }>(`/document-templates/${id}`)
  return data
}

/** Новая версия файла. Ответ — карточка с отчётом проверки этой версии. */
export async function uploadDocumentTemplateVersion(
  id: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<DocumentTemplateDetail> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<DocumentTemplateDetail>(
    `/document-templates/${id}/versions`,
    form,
    {
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100))
      },
    },
  )
  return data
}

export async function publishDocumentTemplate(id: string): Promise<DocumentTemplateDetail> {
  const { data } = await api.post<DocumentTemplateDetail>(`/document-templates/${id}/publish`)
  return data
}

export async function unpublishDocumentTemplate(id: string): Promise<DocumentTemplateDetail> {
  const { data } = await api.post<DocumentTemplateDetail>(`/document-templates/${id}/unpublish`)
  return data
}

/** Ссылка на исходный DOCX версии (подписанная, 15 минут). */
export async function fetchDocumentTemplateSource(
  id: string,
  versionId: string,
): Promise<{ url: string; fileName: string | null }> {
  const { data } = await api.get<{ url: string; fileName: string | null }>(
    `/document-templates/${id}/versions/${versionId}/source`,
  )
  return data
}

/** Проверочный документ на демонстрационных данных. */
export function downloadDocumentTemplateTest(
  id: string,
  versionId?: string,
): Promise<DownloadedFile> {
  return requestFile(`/document-templates/${id}/test`, versionId ? { versionId } : undefined, {})
}

/** Документ для студента по опубликованной версии. Данные сервер берёт из профиля. */
export function generateDocumentFromTemplate(
  id: string,
  studentId: string,
): Promise<DownloadedFile> {
  return requestFile(`/document-templates/${id}/generate`, undefined, { body: { studentId } })
}
