import { z } from 'zod'

// Запись в деканат (docs/ACADEMIC_CORE.md, задача 16). Тип/статус — строки (SSOT здесь).
export const APPOINTMENT_TYPES = ['CONSULTATION', 'DOCUMENT', 'ACADEMIC', 'OTHER'] as const
export const AppointmentTypeSchema = z.enum(APPOINTMENT_TYPES)
export type AppointmentType = z.infer<typeof AppointmentTypeSchema>

export const APPOINTMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED',
] as const
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES)
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>

const isoDateTime = z.string().datetime({ offset: true })

export const CreateAppointmentSchema = z
  .object({
    type: AppointmentTypeSchema.default('OTHER'),
    requestedAt: isoDateTime,
    topic: z.string().max(1000).optional(),
    applicationId: z.string().min(1).optional(),
  })
  .strict()
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>

export const ConfirmAppointmentSchema = z
  .object({
    scheduledAt: isoDateTime,
    staffNote: z.string().max(1000).optional(),
  })
  .strict()
export type ConfirmAppointmentInput = z.infer<typeof ConfirmAppointmentSchema>

export const AppointmentListQuerySchema = z
  .object({
    status: AppointmentStatusSchema.optional(),
  })
  .strict()
export type AppointmentListQueryInput = z.infer<typeof AppointmentListQuerySchema>
