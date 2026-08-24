import type {
  ComplaintPriorityValue,
  ComplaintStatusValue,
  ComplaintTargetTypeValue,
} from '@studenthub/shared-schemas'
export type { ComplaintPriorityValue, ComplaintStatusValue, ComplaintTargetTypeValue }

export interface ComplaintUser {
  id: string
  firstName: string
  lastName: string
}

export interface Complaint {
  id: string
  targetType: ComplaintTargetTypeValue
  targetId: string
  reason: string
  status: ComplaintStatusValue
  /**
   * Приоритет очереди — сервер считает его из категории цели (complaintPriorityFor).
   * Необязательное: ответ API без этого поля (старый сервер, миграция ещё не применена)
   * не должен ломать таблицу — UI выводит приоритет из категории тем же правилом.
   */
  priority?: ComplaintPriorityValue
  universityId: string | null
  resolution: string | null
  resolvedAt: string | null
  createdAt: string
  reporter: ComplaintUser
  resolvedBy: ComplaintUser | null
}

export interface ComplaintChatMessage {
  id: string
  senderId: string
  content: string
  createdAt: string
  deletedAt: string | null
  sender: ComplaintUser
}

export const COMPLAINT_STATUSES: ComplaintStatusValue[] = [
  'PENDING',
  'REVIEWING',
  'RESOLVED',
  'DISMISSED',
]

// Порядок = порядок разбора очереди, он же порядок в фильтре.
export const COMPLAINT_PRIORITIES: ComplaintPriorityValue[] = ['HIGH', 'MEDIUM', 'LOW']
