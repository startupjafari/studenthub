import type {
  CreateCustomDocumentTypeInput,
  UpdateDocumentTypeInput,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'

export const documentTypeKeys = {
  all: ['document-types'] as const,
  list: () => ['document-types', 'list'] as const,
  effective: () => ['document-types', 'effective'] as const,
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

// Управление каталогом — только админ вуза.
export async function fetchDocumentTypes(): Promise<EffectiveDocumentType[]> {
  const { data } = await api.get<EffectiveDocumentType[]>('/document-types')
  return data
}

// Каталог своего вуза для выбора типа — открыт любой роли; вуз сервер берёт из токена.
export async function fetchEffectiveDocumentTypes(): Promise<EffectiveDocumentType[]> {
  const { data } = await api.get<EffectiveDocumentType[]>('/document-types/effective')
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
