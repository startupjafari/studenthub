import type {
  ApplicationCategoryCode,
  DeliveryMode,
  FormFieldType,
  ManagedServicesQueryInput,
  UpsertApplicationServiceInput,
} from '@studenthub/shared-schemas'
import { api, getPaged, type Paged } from '../../../shared/api'
import type { ServiceFormFieldOption } from './application-service-api'

// Управление каталогом услуг (docs/PROJECT.md §8.3 «Заявки (услуги)»): админ вуза ведёт
// услуги вуза и настраивает шаблоны под себя, админ платформы — шаблоны.

export interface ManageCategory {
  id: string
  code: ApplicationCategoryCode
  nameRu: string
  nameKk: string
  nameEn: string
}

export interface ManagedServiceRow {
  id: string
  code: string
  universityId: string | null
  nameRu: string
  nameKk: string
  nameEn: string
  slaHours: number
  deliveryModes: DeliveryMode[]
  active: boolean
  sortOrder: number
  updatedAt: string
  category: ManageCategory
  isTemplate: boolean
  /** У шаблона — id копии вуза, если вуз его уже настроил. */
  customizedId: string | null
  requirementsCount: number
  formFieldsCount: number
}

export interface ManagedServiceDetail {
  id: string
  categoryId: string
  universityId: string | null
  code: string
  nameRu: string
  nameKk: string
  nameEn: string
  descriptionRu: string | null
  descriptionKk: string | null
  descriptionEn: string | null
  instructionsRu: string | null
  instructionsKk: string | null
  instructionsEn: string | null
  slaHours: number
  deliveryModes: DeliveryMode[]
  requiresPickup: boolean
  facultyScoped: boolean
  active: boolean
  sortOrder: number
  requirements: Array<{
    code: string
    documentType: string | null
    titleRu: string
    titleKk: string
    titleEn: string
    description: string | null
    required: boolean
    allowStorage: boolean
    allowUpload: boolean
    maxFiles: number
  }>
  formFields: Array<{
    code: string
    type: FormFieldType
    labelRu: string
    labelKk: string
    labelEn: string
    placeholderRu: string | null
    placeholderKk: string | null
    placeholderEn: string | null
    required: boolean
    options: ServiceFormFieldOption[] | null
  }>
  isTemplate: boolean
  /** Можно ли сохранять: шаблон админу вуза только для просмотра. */
  editable: boolean
}

export const catalogAdminKeys = {
  all: ['service-catalog-admin'] as const,
  categories: () => ['service-catalog-admin', 'categories'] as const,
  list: (params: Partial<ManagedServicesQueryInput>) =>
    ['service-catalog-admin', 'list', params] as const,
  detail: (id: string) => ['service-catalog-admin', 'detail', id] as const,
}

export async function fetchManageCategories(): Promise<ManageCategory[]> {
  const { data } = await api.get<ManageCategory[]>('/application-categories/manage')
  return data
}

export function fetchManagedServices(
  params: Partial<ManagedServicesQueryInput> = {},
): Promise<Paged<ManagedServiceRow>> {
  return getPaged<ManagedServiceRow>('/application-services/manage', {
    page: 1,
    limit: 20,
    ...params,
  })
}

export async function fetchManagedService(id: string): Promise<ManagedServiceDetail> {
  const { data } = await api.get<ManagedServiceDetail>(`/application-services/manage/${id}`)
  return data
}

export async function createApplicationService(
  input: UpsertApplicationServiceInput,
): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/application-services', input)
  return data
}

export async function updateApplicationService(
  id: string,
  input: UpsertApplicationServiceInput,
): Promise<{ id: string }> {
  const { data } = await api.put<{ id: string }>(`/application-services/${id}`, input)
  return data
}

export async function customizeApplicationService(templateId: string): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>(`/application-services/${templateId}/customize`)
  return data
}
