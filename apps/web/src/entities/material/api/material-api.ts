import type { AxiosProgressEvent } from 'axios'
import type { CreateMaterialInput } from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { Material, MaterialFile } from '../model/types'

export const materialKeys = {
  all: ['materials'] as const,
  list: (groupId?: string) => ['materials', 'list', groupId ?? 'all'] as const,
}

export async function fetchMaterials(groupId?: string): Promise<Material[]> {
  const { data } = await api.get<Material[]>('/materials', { params: { groupId } })
  return data
}

export async function createMaterialRequest(input: CreateMaterialInput): Promise<Material> {
  const { data } = await api.post<Material>('/materials', input)
  return data
}

export async function uploadMaterialFileRequest(
  id: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MaterialFile> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<MaterialFile>(`/materials/${id}/files`, form, {
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
    },
  })
  return data
}

export async function fetchMaterialFileUrl(id: string, fileId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/materials/${id}/files/${fileId}/presigned`)
  return data.url
}

export async function deleteMaterialRequest(id: string): Promise<void> {
  await api.delete(`/materials/${id}`)
}
