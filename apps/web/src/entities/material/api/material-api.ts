import type { AxiosProgressEvent } from 'axios'
import type {
  CreateMaterialInput,
  MaterialListQueryInput,
  MaterialSubjectsQueryInput,
} from '@studenthub/shared-schemas'
import { api, needsDirectUpload, uploadDirect, type PresignedTarget } from '../../../shared/api'
import type { Material, MaterialFile, MaterialSubjectCount } from '../model/types'

export const materialKeys = {
  all: ['materials'] as const,
  list: (filters: Partial<MaterialListQueryInput> = {}) => ['materials', 'list', filters] as const,
  subjects: (filters: Partial<MaterialSubjectsQueryInput> = {}) =>
    ['materials', 'subjects', filters] as const,
}

/**
 * Страница материалов, свежие сверху. Сервер отдаёт до `MATERIAL_LIST_LIMIT` (или `limit`)
 * строк; следующая страница — с `cursor` = id последнего материала.
 */
export async function fetchMaterials(
  filters: Partial<MaterialListQueryInput> = {},
): Promise<Material[]> {
  const { data } = await api.get<Material[]>('/materials', { params: filters })
  return data
}

/** Число материалов по дисциплинам — по всей выборке, а не по одной странице списка. */
export async function fetchMaterialSubjects(
  filters: Partial<MaterialSubjectsQueryInput> = {},
): Promise<MaterialSubjectCount[]> {
  const { data } = await api.get<MaterialSubjectCount[]>('/materials/subjects', {
    params: filters,
  })
  return data
}

export async function createMaterialRequest(input: CreateMaterialInput): Promise<Material> {
  const { data } = await api.post<Material>('/materials', input)
  return data
}

/**
 * Загрузка файла материала. Путь выбирается по размеру: до порога — буферный,
 * больше — прямой в MinIO по подписанной ссылке (лекция или презентация легко
 * перевешивает порог, а лимит категории DOCUMENT — 25 МБ).
 */
export async function uploadMaterialFileRequest(
  id: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MaterialFile> {
  if (needsDirectUpload(file.size)) {
    return uploadDirect<MaterialFile>({
      file,
      presign: async (mime) => {
        const { data } = await api.post<PresignedTarget>(`/materials/${id}/files/presign`, {
          mime,
        })
        return data
      },
      confirm: async (key, name) => {
        const { data } = await api.post<MaterialFile>(`/materials/${id}/files/confirm`, {
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
