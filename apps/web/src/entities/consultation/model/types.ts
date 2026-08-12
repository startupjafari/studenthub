import type { ConsultationStatus } from '@studenthub/shared-schemas'
export type { ConsultationStatus }

export interface ConsultationSlot {
  id: string
  startsAt: string
  endsAt: string
  location: string | null
  isOnline: boolean
  status: ConsultationStatus
  topic: string | null
  createdAt: string
  teacher: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  student: { id: string; firstName: string; lastName: string } | null
}

export interface ConsultationTeacher {
  teacherId: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  openSlots: number
}
