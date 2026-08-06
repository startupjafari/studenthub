import type { AxiosProgressEvent } from 'axios'
import type {
  ApplicationListQueryInput,
  CreateApplicationInput,
  TransitionApplicationInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ApplicationAttachment, ApplicationDetail, ApplicationListItem } from '../model/types'

export const applicationKeys = {
  all: ['applications'] as const,
  list: (filters: Partial<ApplicationListQueryInput> = {}) =>
    ['applications', 'list', filters] as const,
  detail: (id: string) => ['applications', 'detail', id] as const,
}

export async function fetchApplications(
  filters: Partial<ApplicationListQueryInput> = {},
): Promise<ApplicationListItem[]> {
  const { data } = await api.get<ApplicationListItem[]>('/applications', {
    params: { page: 1, limit: 100, ...filters },
  })
  return data
}

export async function fetchApplication(id: string): Promise<ApplicationDetail> {
  const { data } = await api.get<ApplicationDetail>(`/applications/${id}`)
  return data
}

export async function createApplicationRequest(
  input: CreateApplicationInput,
): Promise<ApplicationListItem> {
  const { data } = await api.post<ApplicationListItem>('/applications', input)
  return data
}

export async function transitionApplicationRequest(
  id: string,
  input: TransitionApplicationInput,
): Promise<ApplicationListItem> {
  const { data } = await api.patch<ApplicationListItem>(`/applications/${id}/status`, input)
  return data
}

export async function withdrawApplicationRequest(id: string): Promise<void> {
  await api.delete(`/applications/${id}`)
}

export async function uploadApplicationAttachment(
  id: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ApplicationAttachment> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<ApplicationAttachment>(`/applications/${id}/attachments`, form, {
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })
  return data
}

export async function fetchAttachmentUrl(id: string, fileId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/applications/${id}/attachments/${fileId}/presigned`,
  )
  return data.url
}
