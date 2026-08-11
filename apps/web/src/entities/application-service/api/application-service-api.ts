import type {
  ApplicationServiceStatus,
  DeliveryType,
  DeliveryMode,
  FormFieldType,
  ApplicationCategoryCode,
} from '@studenthub/shared-schemas'
import { api } from '../../../shared/api'
import type { ResponseWithMeta } from '../../../shared/api/instance'

// ── Типы ответов бэкенда (домен «Услуги университета») ───────────────────────
// Локализованные поля приходят тройками nameRu/nameKk/nameEn — фронт выбирает по локали (см. lib/localize).

export interface ServiceCard {
  id: string
  categoryId: string
  code: string
  nameRu: string
  nameKk: string
  nameEn: string
  descriptionRu: string | null
  descriptionKk: string | null
  descriptionEn: string | null
  slaHours: number
  deliveryModes: DeliveryMode[]
  requiresPickup: boolean
  processingMode: string
}

export interface CategoryWithServices {
  id: string
  code: ApplicationCategoryCode
  nameRu: string
  nameKk: string
  nameEn: string
  description: string | null
  icon: string | null
  services: ServiceCard[]
}

export interface ServiceRequirement {
  id: string
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
}

export interface ServiceFormFieldOption {
  value: string
  labelRu?: string
  labelKk?: string
  labelEn?: string
}

export interface ServiceFormField {
  id: string
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
  validation: Record<string, unknown> | null
}

export interface ServiceDetail extends ServiceCard {
  instructionsRu: string | null
  instructionsKk: string | null
  instructionsEn: string | null
  requirements: ServiceRequirement[]
  formFields: ServiceFormField[]
}

export interface ApplicationServiceRef {
  id: string
  code: string
  nameRu: string
  nameKk: string
  nameEn: string
  slaHours: number
  descriptionRu?: string | null
  descriptionKk?: string | null
  descriptionEn?: string | null
}

export interface ApplicationListItem {
  id: string
  number: string | null
  status: ApplicationServiceStatus
  deliveryType: DeliveryType | null
  formData: Record<string, unknown>
  studentId: string
  facultyId: string | null
  universityId: string
  assignedToId: string | null
  submittedAt: string | null
  dueAt: string | null
  readyAt: string | null
  issuedAt: string | null
  cancelledAt: string | null
  createdAt: string
  service: ApplicationServiceRef
}

export interface TimelineEvent {
  id: string
  action: string
  fromStatus: ApplicationServiceStatus | null
  toStatus: ApplicationServiceStatus | null
  comment: string | null
  actorId: string | null
  createdAt: string
}

export interface ApplicationDetail extends ApplicationListItem {
  rejectionReason: string | null
  pickupLocation: string | null
  pickupInstructions: string | null
  events: TimelineEvent[]
}

export interface ApplicationListPage {
  items: ApplicationListItem[]
  total: number
}

export interface ApplicationFilters {
  page?: number
  limit?: number
  status?: ApplicationServiceStatus
  serviceId?: string
  categoryCode?: ApplicationCategoryCode
  overdue?: boolean
  dueToday?: boolean
  sortBy?: 'createdAt' | 'submittedAt' | 'dueAt' | 'status'
  sortOrder?: 'asc' | 'desc'
}

// ── Query-ключи ──────────────────────────────────────────────────────────────
export const applicationKeys = {
  all: ['applications-v2'] as const,
  categories: () => ['applications-v2', 'categories'] as const,
  service: (id: string) => ['applications-v2', 'service', id] as const,
  list: (filters: ApplicationFilters) => ['applications-v2', 'list', filters] as const,
  detail: (id: string) => ['applications-v2', 'detail', id] as const,
}

// ── Каталог ──────────────────────────────────────────────────────────────────
export async function fetchCategories(): Promise<CategoryWithServices[]> {
  const { data } = await api.get<CategoryWithServices[]>('/application-categories')
  return data
}

export async function fetchService(id: string): Promise<ServiceDetail> {
  const { data } = await api.get<ServiceDetail>(`/application-services/${id}`)
  return data
}

// ── Заявки ───────────────────────────────────────────────────────────────────
export async function fetchApplications(filters: ApplicationFilters): Promise<ApplicationListPage> {
  const res = (await api.get<ApplicationListItem[]>('/applications', {
    params: filters,
  })) as ResponseWithMeta & { data: ApplicationListItem[] }
  return { items: res.data, total: res.meta?.total ?? res.data.length }
}

export async function fetchApplication(id: string): Promise<ApplicationDetail> {
  const { data } = await api.get<ApplicationDetail>(`/applications/${id}`)
  return data
}

export async function createDraftRequest(serviceId: string): Promise<ApplicationListItem> {
  const { data } = await api.post<ApplicationListItem>('/applications', { serviceId })
  return data
}

export async function updateDraftRequest(
  id: string,
  body: { deliveryType?: DeliveryType; formData?: Record<string, unknown> },
): Promise<ApplicationListItem> {
  const { data } = await api.patch<ApplicationListItem>(`/applications/${id}`, body)
  return data
}

export async function submitApplicationRequest(id: string): Promise<ApplicationListItem> {
  const { data } = await api.post<ApplicationListItem>(`/applications/${id}/submit`)
  return data
}

export async function cancelApplicationRequest(
  id: string,
  reason?: string,
): Promise<ApplicationListItem> {
  const { data } = await api.post<ApplicationListItem>(`/applications/${id}/cancel`, { reason })
  return data
}
