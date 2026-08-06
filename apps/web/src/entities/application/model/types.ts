// Типы заявок — зеркало ответов API (docs/PROJECT.md §3.2, Ф7).
import type { ApplicationStatusValue, AppTypeValue } from '@studenthub/shared-schemas'
import type { Role } from '@studenthub/shared-types'

export type { ApplicationStatusValue, AppTypeValue }

export interface ApplicationListItem {
  id: string
  type: AppTypeValue
  subject: string
  status: ApplicationStatusValue
  studentId: string
  facultyId: string
  createdAt: string
  updatedAt: string
}

export interface ApplicationHistoryEntry {
  id: string
  fromStatus: ApplicationStatusValue | null
  toStatus: ApplicationStatusValue
  comment: string | null
  createdAt: string
  changedBy: { id: string; firstName: string; lastName: string; role: Role }
}

export interface ApplicationAttachment {
  id: string
  mime: string
  size: number
  createdAt: string
}

export interface ApplicationDetail extends ApplicationListItem {
  body: string
  student: { id: string; firstName: string; lastName: string }
  attachments: ApplicationAttachment[]
  history: ApplicationHistoryEntry[]
}

// Порядок статусов для таймлайна/бейджей.
export const APPLICATION_STATUSES: ApplicationStatusValue[] = [
  'NEW',
  'PROCESSING',
  'CLARIFICATION',
  'APPROVED',
  'REJECTED',
  'READY',
  'CLOSED',
]

export const APP_TYPES: AppTypeValue[] = [
  'CERTIFICATE',
  'MILITARY',
  'UNIVERSAL',
  'ACADEMIC',
  'FINANCIAL',
  'TECHNICAL',
  'OTHER',
]

// Допустимые переходы (зеркало backend ALLOWED_TRANSITIONS) — для рендера доступных действий декану.
export const ALLOWED_TRANSITIONS: Record<ApplicationStatusValue, ApplicationStatusValue[]> = {
  NEW: ['PROCESSING'],
  PROCESSING: ['CLARIFICATION', 'APPROVED', 'REJECTED'],
  CLARIFICATION: ['PROCESSING'],
  APPROVED: ['READY'],
  REJECTED: ['CLOSED'],
  READY: ['CLOSED'],
  CLOSED: [],
}
