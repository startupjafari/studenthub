import { apiGetPaged } from './client'

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
export async function fetchOpenComplaints(limit = 30): Promise<ComplaintPage> {
  return apiGetPaged<Complaint>(`/complaints?status=PENDING&page=1&limit=${limit}`)
}
