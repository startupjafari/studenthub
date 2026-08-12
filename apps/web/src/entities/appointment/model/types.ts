import type { AppointmentStatus, AppointmentType } from '@studenthub/shared-schemas'
export type { AppointmentStatus, AppointmentType }

export interface Appointment {
  id: string
  type: string
  status: AppointmentStatus
  topic: string | null
  requestedAt: string
  scheduledAt: string | null
  applicationId: string | null
  staffNote: string | null
  createdAt: string
  facultyId: string
  student: { id: string; firstName: string; lastName: string }
  assignedTo: { id: string; firstName: string; lastName: string } | null
}
