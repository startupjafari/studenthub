import { apiGetPaged, apiGet, apiPatch, apiPost } from './client'

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
  /** Кто взял жалобу в разбор. null — ничья. */
  reviewingBy?: { id: string; firstName: string; lastName: string } | null
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

/**
 * Одна жалоба целиком — для карточки разбора. `targetReports` считает сервер, `targetOwnerId`
 * он же и разрешает: в жалобе на пост или сообщение автора не видно, а блокируют человека.
 * У снесённой цели владельца нет — приходит null.
 */
export interface ComplaintCard extends Complaint {
  targetReports: number
  targetOwnerId: string | null
}

export async function fetchComplaint(id: string): Promise<ComplaintCard> {
  return apiGet<ComplaintCard>(`/complaints/${id}`)
}

/**
 * Медиана времени разбора за последний месяц, часы. Показывается над разобранными:
 * очередь отвечает на «сколько осталось», а медиана — на «быстро ли мы это делаем».
 * По отказу молчит: список жалоб важнее цифры над ним.
 */
export async function fetchResolutionMedian(): Promise<number | null> {
  const report = await apiGet<{ medianHours: number | null }>(
    '/analytics/platform/complaints-latency',
  )
  return report.medianHours
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
export type ResolveAction = 'DELETE_CONTENT' | 'BLOCK_USER' | 'WARN_USER' | 'DISMISS'

export interface ResolveOptions {
  /** Внутренняя записка модератора: уходит в журнал, нарушителю не показывается. */
  comment?: string
  applyToDuplicates?: boolean
  /** Нужен только для BLOCK_USER: блокировка с телефона подтверждается кодом. */
  code?: string
  /** Срок блокировки в днях. Без него блокировка бессрочная. */
  blockDays?: number
}

export async function resolveComplaint(
  id: string,
  action: ResolveAction,
  options: ResolveOptions = {},
): Promise<Complaint> {
  return apiPatch<Complaint>(`/complaints/${id}/resolve`, {
    action,
    ...(options.comment ? { comment: options.comment } : {}),
    ...(options.applyToDuplicates ? { applyToDuplicates: true } : {}),
    ...(options.code ? { code: options.code } : {}),
    ...(options.blockDays ? { blockDays: options.blockDays } : {}),
  })
}

/**
 * Вернуть жалобу в очередь. Побочные действия решения не отменяются: снятый контент не
 * возвращается, блокировка снимается отдельно, в разделе «Люди».
 */
export async function reopenComplaint(id: string): Promise<Complaint> {
  return apiPatch<Complaint>(`/complaints/${id}/reopen`, {})
}

/**
 * Завести жалобу по обращению в поддержку.
 *
 * Люди жалуются на других людей через поддержку: адрес известен, а кнопку «пожаловаться»
 * рядом с обидчиком ещё надо найти. До этой ручки путь кончался тупиком — поддержка
 * читала жалобу, а передать её модерации было нечем. Автором жалобы сервер делает автора
 * обращения, а не модератора: жаловался он.
 */
export async function createComplaintFromSupport(
  chatId: string,
  targetId: string,
): Promise<Complaint> {
  return apiPost<Complaint>('/complaints/from-support', { chatId, targetId })
}

/**
 * Взять жалобу в разбор. То же квитирование, что кнопкой в Telegram: команда видит, что
 * работа занята, и двое не разбирают одно и то же. Перехватить чужую сервер не даст.
 */
export async function takeComplaint(id: string): Promise<{ takenBy: string }> {
  return apiPatch<{ takenBy: string }>(`/complaints/${id}/take`, {})
}
