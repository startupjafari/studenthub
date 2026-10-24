import type {
  AddApplicationResultInput,
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

/** Поле анкеты в карточке заявки: по нему ответы formData показываются с подписями. */
export interface ApplicationFormField extends ServiceFormField {
  // Выключенное поле: ответ на него в заявке остался, править его уже нельзя.
  active: boolean
}

/** Действующее требование услуги в карточке заявки: по ним строится чек-лист исправления. */
export type ApplicationRequirementRef = Pick<
  ServiceRequirement,
  'id' | 'documentType' | 'titleRu' | 'titleKk' | 'titleEn' | 'required'
>

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
  // Есть только в деталях заявки (GET /applications/:id).
  deliveryModes?: DeliveryMode[]
  requirements?: ApplicationRequirementRef[]
  formFields?: ApplicationFormField[]
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
  student?: { id: string; firstName: string; lastName: string; groupId: string | null }
}

export interface TimelineEvent {
  id: string
  action: string
  fromStatus: ApplicationServiceStatus | null
  toStatus: ApplicationServiceStatus | null
  comment: string | null
  actorId: string | null
  createdAt: string
  // Требование, к которому относится событие документа (DOCUMENT_ADDED / DOCUMENT_ACCEPTED):
  // по нему событие подписывается названием на языке интерфейса, а не русским comment.
  requirementId?: string | null
}

/** Страница приложенного документа (паспорт — разворот и прописка, диплом — с приложением). */
export interface ApplicationDocumentFile {
  id: string
  mime: string
  order: number | null
}

export interface ApplicationDocumentItem {
  id: string
  requirementId: string
  documentId: string | null
  source: string
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REPLACEMENT_REQUIRED'
  reviewComment: string | null
  snapshotTitle: string | null
  requirement: {
    id: string
    titleRu: string
    titleKk: string
    titleEn: string
    required: boolean
  }
  // Есть только в деталях заявки (GET /applications/:id); у старого API поля нет.
  files?: ApplicationDocumentFile[]
}

export interface ApplicationResultItem {
  id: string
  type: string
  documentId: string | null
  documentNumber: string | null
  note: string | null
  createdAt: string
  // Выданная справка отозвана: файл у студента остался, но ничего не подтверждает.
  revoked?: boolean
}

/** Справка, сформированная платформой (её и только её отзывают по коду проверки). */
export const CERTIFICATE_RESULT_TYPE = 'DOCUMENT'

export interface ApplicationDetail extends ApplicationListItem {
  rejectionReason: string | null
  pickupLocation: string | null
  pickupInstructions: string | null
  pickupCode?: string | null
  events: TimelineEvent[]
  documents: ApplicationDocumentItem[]
  results: ApplicationResultItem[]
}

export interface QueueStats {
  new: number
  inWork: number
  actionNeeded: number
  ready: number
  overdue: number
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
  assignees: (id: string) => ['applications-v2', 'assignees', id] as const,
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

export async function resubmitApplicationRequest(id: string): Promise<ApplicationListItem> {
  const { data } = await api.post<ApplicationListItem>(`/applications/${id}/resubmit`)
  return data
}

// ── Документы заявки ─────────────────────────────────────────────────────────
export async function attachApplicationDocument(
  appId: string,
  requirementId: string,
  documentId: string,
): Promise<void> {
  await api.post(`/applications/${appId}/documents`, { requirementId, documentId })
}

export async function removeApplicationDocument(
  appId: string,
  requirementId: string,
): Promise<void> {
  await api.delete(`/applications/${appId}/documents/${requirementId}`)
}

// `fileId` — конкретная страница документа; без него сервер отдаёт первую.
export async function fetchApplicationDocumentUrl(
  appId: string,
  docId: string,
  fileId?: string,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(`/applications/${appId}/documents/${docId}/url`, {
    params: fileId ? { fileId } : undefined,
  })
  return data.url
}

// ── Обработка сотрудником (PR4) ──────────────────────────────────────────────
export async function fetchQueueStats(): Promise<QueueStats> {
  const { data } = await api.get<QueueStats>('/applications/queue-stats')
  return data
}
export async function takeApplication(id: string): Promise<void> {
  await api.post(`/applications/${id}/take`)
}
export async function requestCorrectionRequest(id: string, comment: string): Promise<void> {
  await api.post(`/applications/${id}/request-correction`, { comment })
}
export async function startPreparationRequest(id: string): Promise<void> {
  await api.post(`/applications/${id}/start-preparation`)
}
export async function rejectApplicationRequest(id: string, reason: string): Promise<void> {
  await api.post(`/applications/${id}/reject`, { reason })
}
export async function addResultRequest(id: string, body: AddApplicationResultInput): Promise<void> {
  await api.post(`/applications/${id}/results`, body)
}

/**
 * Сформировать справку об обучении вместо загрузки готового файла.
 *
 * Всё делает сервер: собирает бланк по данным студента, регистрирует документ в журнале
 * выгрузок и выдаёт его студенту. Возвращает код проверки — его печатают в бланке, и по
 * нему справку подтверждают.
 */
export async function issueCertificateRequest(
  id: string,
  locale: string,
): Promise<{ documentId: string; verificationCode: string }> {
  const { data } = await api.post<{ documentId: string; verificationCode: string }>(
    `/applications/${id}/results/certificate`,
    undefined,
    { params: { locale } },
  )
  return data
}

// Ссылка на выданный документ: гейт по scope заявки, а не по владению документом —
// поэтому и студент, и обработчик берут её здесь, а не в домене «Документы».
export async function fetchApplicationResultUrl(
  appId: string,
  resultId: string,
  download = false,
): Promise<string> {
  const { data } = await api.get<{ url: string }>(
    `/applications/${appId}/results/${resultId}/url`,
    { params: download ? { download: '1' } : undefined },
  )
  return data.url
}
export async function markReadyRequest(
  id: string,
  body: { pickupLocation?: string; pickupInstructions?: string },
): Promise<void> {
  await api.post(`/applications/${id}/mark-ready`, body)
}
// Код получения называет студент; сервер сверяет его с выданным при «готово».
export async function issueApplicationRequest(id: string, pickupCode: string): Promise<void> {
  await api.post(`/applications/${id}/issue`, { pickupCode })
}
export async function deliverApplicationRequest(id: string): Promise<void> {
  await api.post(`/applications/${id}/deliver`)
}
export async function acceptDocumentRequest(appId: string, docId: string): Promise<void> {
  await api.post(`/applications/${appId}/documents/${docId}/accept`)
}
export async function requestDocReplacementRequest(
  appId: string,
  docId: string,
  comment: string,
): Promise<void> {
  await api.post(`/applications/${appId}/documents/${docId}/request-replacement`, { comment })
}

// ── Ответственный и отзыв справки ────────────────────────────────────────────

/** Сотрудник, которому можно поручить заявку (админ/модератор вуза, декан факультета). */
export interface ApplicationAssignee {
  id: string
  firstName: string
  lastName: string
  role: string
}

export async function fetchApplicationAssignees(id: string): Promise<ApplicationAssignee[]> {
  const { data } = await api.get<ApplicationAssignee[]>(`/applications/${id}/assignees`)
  return data
}

export async function assignApplicationRequest(id: string, userId: string): Promise<void> {
  await api.post(`/applications/${id}/assign`, { userId })
}

// Файл у студента остаётся; отзыв меняет ответ проверки по коду на «документ отозван».
export async function revokeCertificateRequest(id: string, reason?: string): Promise<void> {
  await api.post(`/applications/${id}/results/certificate/revoke`, reason ? { reason } : {})
}
