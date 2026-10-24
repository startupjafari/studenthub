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
  /** Кто взял жалобу в разбор (PATCH /complaints/:id/take); перехватить чужую нельзя. */
  reviewingBy?: ComplaintUser | null
}

/** Текст обжалованного поста, комментария или сторис (`GET /complaints/:id`). */
export interface ComplaintTargetPreview {
  title: string | null
  text: string | null
  mediaCount: number
  /** Автор удалил цель сам — текст остаётся предметом жалобы. */
  deleted: boolean
}

/** Карточка разбора: строка очереди плюс то, что сервер считает только для одной жалобы. */
export interface ComplaintCard extends Complaint {
  /** Сколько разных людей жаловались на ту же цель. */
  targetReports: number
  /** Кто отвечает за цель; у снесённой — null. */
  targetOwnerId: string | null
  /** null — у жалобы на человека или сообщение и у цели, которой больше нет. */
  targetPreview: ComplaintTargetPreview | null
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
