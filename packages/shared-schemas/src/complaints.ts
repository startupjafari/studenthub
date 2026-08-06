import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Жалобы (docs/PROJECT.md §11, Ф11). Enum'ы дублируют Prisma ComplaintTargetType/ComplaintStatus.
export const ComplaintTargetTypeSchema = z.enum(['POST', 'STORY', 'COMMENT', 'MESSAGE', 'USER'])
export type ComplaintTargetTypeValue = z.infer<typeof ComplaintTargetTypeSchema>

export const ComplaintStatusSchema = z.enum(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
export type ComplaintStatusValue = z.infer<typeof ComplaintStatusSchema>

export const CreateComplaintSchema = z
  .object({
    targetType: ComplaintTargetTypeSchema,
    targetId: z.string().min(1),
    reason: z.string().min(1).max(2000),
  })
  .strict()
export type CreateComplaintInput = z.infer<typeof CreateComplaintSchema>

// Действие модератора при разрешении жалобы (задача 11.4).
export const ResolveComplaintSchema = z
  .object({
    action: z.enum(['DELETE_CONTENT', 'BLOCK_USER', 'DISMISS']),
    comment: z.string().max(2000).optional(),
  })
  .strict()
export type ResolveComplaintInput = z.infer<typeof ResolveComplaintSchema>

export const ComplaintListQuerySchema = OffsetPaginationSchema.extend({
  status: ComplaintStatusSchema.optional(),
})
export type ComplaintListQueryInput = z.infer<typeof ComplaintListQuerySchema>
