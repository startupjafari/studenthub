import { z } from 'zod'

// Консультации (docs/ACADEMIC_CORE.md, задача 15). Статус — строка (SSOT здесь).
export const CONSULTATION_STATUSES = ['OPEN', 'BOOKED', 'CANCELLED'] as const
export const ConsultationStatusSchema = z.enum(CONSULTATION_STATUSES)
export type ConsultationStatus = z.infer<typeof ConsultationStatusSchema>

const isoDateTime = z.string().datetime({ offset: true })

export const CreateSlotSchema = z
  .object({
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    location: z.string().max(200).optional(),
    isOnline: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
export type CreateSlotInput = z.infer<typeof CreateSlotSchema>

export const BookSlotSchema = z
  .object({
    topic: z.string().max(500).optional(),
  })
  .strict()
export type BookSlotInput = z.infer<typeof BookSlotSchema>

export const SlotListQuerySchema = z
  .object({
    teacherId: z.string().min(1).optional(),
  })
  .strict()
export type SlotListQueryInput = z.infer<typeof SlotListQuerySchema>
