import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'
import { PostAudienceSchema } from './posts.js'

// События (docs/PROJECT.md §3.5, Ф10). Аудитория — тот же enum, что у постов (видимость по аналогии).

const eventBase = {
  audience: PostAudienceSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  location: z.string().max(300).optional(),
  isOnline: z.boolean().optional(),
  // ISO-8601 с таймзоной. Клиент присылает абсолютный момент; хранение — UTC.
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  facultyId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
}

const endAfterStart = (v: { startsAt: string; endsAt?: string }, ctx: z.RefinementCtx): void => {
  if (v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Окончание должно быть позже начала',
      path: ['endsAt'],
    })
  }
}

export const CreateEventSchema = z.object(eventBase).strict().superRefine(endAfterStart)
export type CreateEventInput = z.infer<typeof CreateEventSchema>

export const UpdateEventSchema = z
  .object({
    title: eventBase.title.optional(),
    description: eventBase.description.optional(),
    location: z.string().max(300).nullable().optional(),
    isOnline: z.boolean().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  })
  .strict()
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>

// Список: ближайшие/прошедшие + только свои (организатор/участник) + пагинация.
export const EventListQuerySchema = OffsetPaginationSchema.extend({
  filter: z.enum(['upcoming', 'past']).default('upcoming'),
  mine: z.coerce.boolean().optional(),
})
export type EventListQueryInput = z.infer<typeof EventListQuerySchema>
