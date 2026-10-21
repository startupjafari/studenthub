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

// Открытые записи ждут ответа деканата или самого приёма; завершённые и отменённые — архив.
export const ACTIVE_APPOINTMENT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'RESCHEDULED',
] as const satisfies readonly AppointmentStatus[]
export const CLOSED_APPOINTMENT_STATUSES = [
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly AppointmentStatus[]

// Срез очереди деканата. По умолчанию — `active`: архив только копится, и в общей выборке
// с потолком он вытеснял бы новые записи.
export const APPOINTMENT_QUEUE_VIEWS = ['active', 'closed', 'all'] as const
export const AppointmentQueueViewSchema = z.enum(APPOINTMENT_QUEUE_VIEWS)
export type AppointmentQueueView = z.infer<typeof AppointmentQueueViewSchema>

// Потолок одной выдачи очереди; дальше — по `cursor` (id последней полученной записи).
export const APPOINTMENT_QUEUE_LIMIT = 300

export const AppointmentListQuerySchema = z
  .object({
    // Точный статус. Задан — срез `view` не применяется.
    status: AppointmentStatusSchema.optional(),
    view: AppointmentQueueViewSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(APPOINTMENT_QUEUE_LIMIT).optional(),
  })
  .strict()
export type AppointmentListQueryInput = z.infer<typeof AppointmentListQuerySchema>
