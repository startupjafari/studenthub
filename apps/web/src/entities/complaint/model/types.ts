import type { ComplaintStatusValue, ComplaintTargetTypeValue } from '@studenthub/shared-schemas'
export type { ComplaintStatusValue, ComplaintTargetTypeValue }

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
