import type {
  CreateCustomDocumentTypeInput,
  UpdateDocumentTypeInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export const documentTypeKeys = {
  all: ['document-types'] as const,
  list: () => ['document-types', 'list'] as const,
}

export interface EffectiveDocumentType {
  typeId: string
  category: string
  fields: string[]
  custom: boolean
  enabled: boolean
  retentionDays: number | null
  label: string | null
}

export async function fetchDocumentTypes(): Promise<EffectiveDocumentType[]> {
  const { data } = await api.get<EffectiveDocumentType[]>('/document-types')
  return data
}

export async function updateDocumentType(
  typeId: string,
  input: UpdateDocumentTypeInput,
): Promise<EffectiveDocumentType[]> {
  const { data } = await api.patch<EffectiveDocumentType[]>(`/document-types/${typeId}`, input)
  return data
}

export async function createCustomDocumentType(
  input: CreateCustomDocumentTypeInput,
): Promise<EffectiveDocumentType[]> {
  const { data } = await api.post<EffectiveDocumentType[]>('/document-types', input)
  return data
}

export async function deleteDocumentType(typeId: string): Promise<EffectiveDocumentType[]> {
  const { data } = await api.delete<EffectiveDocumentType[]>(`/document-types/${typeId}`)
  return data
}
