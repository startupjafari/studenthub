import type {
  CreateMaterialInput,
  MaterialListQueryInput,
  MaterialSubjectsQueryInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, uploadToDomain, type Paged } from '../../../shared/api'
import type { Material, MaterialFile, MaterialSubjectCount } from '../model/types'

export const materialKeys = {
  all: ['materials'] as const,
  list: (filters: Partial<MaterialListQueryInput> = {}) => ['materials', 'list', filters] as const,
  // Страница таблицы — под ключом `list`: сброс списка после создания и удаления сбрасывает и её.
  page: (filters: Partial<MaterialListQueryInput>) =>
    ['materials', 'list', 'page', filters] as const,
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

/** Страница таблицы материалов: порядок, номер страницы и `meta.total` считает сервер. */
export async function fetchMaterialsPage(
  filters: Partial<MaterialListQueryInput> & { page: number; limit: number },
): Promise<Paged<Material>> {
  return getPaged<Material>('/materials', filters)
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
 * Загрузка файла материала. Путь выбирается по размеру: до порога — буферный, до 50 МБ —
 * прямой в MinIO по подписанной ссылке, крупнее (запись лекции до 500 МБ) — частями с
 * докачкой после обрыва. Отмена `signal` у многочастной загрузки удаляет залитые части.
 */
export async function uploadMaterialFileRequest(
  id: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<MaterialFile> {
  return uploadToDomain<MaterialFile>({
    file,
    base: `/materials/${id}/files`,
    scope: `MATERIALS:${id}`,
    onProgress,
    signal,
  })
}

export async function fetchMaterialFileUrl(id: string, fileId: string): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/materials/${id}/files/${fileId}/presigned`)
  return data.url
}

export async function deleteMaterialRequest(id: string): Promise<void> {
  await api.delete(`/materials/${id}`)
}
