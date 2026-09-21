import { apiGetPaged, apiGet, apiPatch } from './client'

// Жалобы: типы повторяют ответ `GET /complaints` (COMPLAINT_SELECT на бэкенде).
//
// Схемы из @studenthub/shared-schemas сюда намеренно не тянутся: мини-апп собирается
// отдельным приложением и читает три поля, а зависимость привела бы за собой zod и весь
// контракт платформы ради типа строки списка.

export type ComplaintStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
export type ComplaintPriority = 'HIGH' | 'MEDIUM' | 'LOW'
export type ComplaintTarget = 'POST' | 'STORY' | 'COMMENT' | 'MESSAGE' | 'USER'

export interface Complaint {
  id: string
  /** Кто разобрал — приходит только у обработанных. */
  resolvedBy?: { id: string; firstName: string; lastName: string } | null
  resolvedAt?: string | null
  targetType: ComplaintTarget
  targetId: string
  reason: string
  status: ComplaintStatus
  priority: ComplaintPriority
  createdAt: string
  reporter: { id: string; firstName: string; lastName: string } | null
}

export interface ComplaintPage {
  items: Complaint[]
  total: number
}

/**
 * Очередь модерации: необработанные сверху, внутри — по приоритету. Порядок задаёт сервер
 * (там же, где он задан для веб-админки), поэтому здесь нет ни сортировки, ни фильтров:
 * две очереди с разным порядком разъехались бы, и модераторы разбирали бы разное.
 */
export interface ComplaintQuery {
  /** `PENDING` — очередь, `RESOLVED` — разобранное. */
  status: ComplaintStatus
  priority?: ComplaintPriority
  limit?: number
}

export async function fetchComplaints(query: ComplaintQuery): Promise<ComplaintPage> {
  const params = new URLSearchParams({
    status: query.status,
    page: '1',
    limit: String(query.limit ?? 30),
  })
  if (query.priority) params.set('priority', query.priority)
  return apiGetPaged<Complaint>(`/complaints?${params.toString()}`)
}

/** Сообщение из переписки вокруг цели жалобы (`GET /complaints/:id/messages`). */
export interface ComplaintMessage {
  id: string
  content: string | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string }
}

/** Одна жалоба целиком — для карточки разбора. `targetReports` считает сервер. */
export async function fetchComplaint(id: string): Promise<Complaint & { targetReports: number }> {
  return apiGet<Complaint & { targetReports: number }>(`/complaints/${id}`)
}

/**
 * Переписка вокруг цели — только для жалоб на сообщение. Доступ открывается самой жалобой
 * и пишется в аудит: читать чужие чаты «просто так» нельзя, а разобрать жалобу на
 * сообщение, не видя соседних реплик, невозможно.
 */
export async function fetchComplaintMessages(id: string): Promise<ComplaintMessage[]> {
  const page = await apiGet<{ items?: ComplaintMessage[] } | ComplaintMessage[]>(
    `/complaints/${id}/messages`,
  )
  return Array.isArray(page) ? page : (page.items ?? [])
}

/**
 * Решение по жалобе.
 *
 * DELETE_CONTENT — снять контент, BLOCK_USER — заблокировать автора, DISMISS — отклонить
 * жалобу. Набор задаёт сервер (ResolveComplaintSchema); для жалобы на пользователя
 * удаление контента недопустимо, и об этом отвечает он же — клиент это не дублирует,
 * иначе два правила разъехались бы.
 */
export type ResolveAction = 'DELETE_CONTENT' | 'BLOCK_USER' | 'DISMISS'

export async function resolveComplaint(
  id: string,
  action: ResolveAction,
  comment?: string,
  applyToDuplicates?: boolean,
): Promise<Complaint> {
  return apiPatch<Complaint>(`/complaints/${id}/resolve`, {
    action,
    ...(comment ? { comment } : {}),
    ...(applyToDuplicates ? { applyToDuplicates: true } : {}),
  })
}

/**
 * Вернуть жалобу в очередь. Побочные действия решения не отменяются: снятый контент не
 * возвращается, блокировка снимается отдельно, в разделе «Люди».
 */
export async function reopenComplaint(id: string): Promise<Complaint> {
  return apiPatch<Complaint>(`/complaints/${id}/reopen`, {})
}
