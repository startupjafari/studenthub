import type { AppointmentStatus } from '../../../entities/appointment'

export const APPT_STATUS_BADGE: Record<
  AppointmentStatus,
  'secondary' | 'success' | 'info' | 'outline' | 'destructive'
> = {
  REQUESTED: 'secondary',
  CONFIRMED: 'success',
  RESCHEDULED: 'info',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
}

export const APPT_STATUS_KEY: Record<AppointmentStatus, string> = {
  REQUESTED: 'status.requested',
  CONFIRMED: 'status.confirmed',
  RESCHEDULED: 'status.rescheduled',
  COMPLETED: 'status.completed',
  CANCELLED: 'status.cancelled',
}

export const APPOINTMENT_TYPES = ['CONSULTATION', 'DOCUMENT', 'ACADEMIC', 'OTHER']
export function typeKey(type: string): string {
  return `type.${type.toLowerCase()}`
}
