import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Задания (docs/ACADEMIC_CORE.md, задача 3). Статусы/типы — строки (SSOT здесь).

export const ASSIGNMENT_TYPES = ['HOMEWORK', 'LAB', 'COURSEWORK', 'PROJECT', 'OTHER'] as const
export const AssignmentTypeSchema = z.enum(ASSIGNMENT_TYPES)
export type AssignmentType = z.infer<typeof AssignmentTypeSchema>

export const SUBMISSION_TYPES = ['TEXT', 'FILE', 'LINK', 'MIXED'] as const
export const SubmissionTypeSchema = z.enum(SUBMISSION_TYPES)
export type SubmissionTypeValue = z.infer<typeof SubmissionTypeSchema>

export const ASSIGNMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const
export const AssignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES)
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>

export const SUBMISSION_STATUSES = ['DRAFT', 'SUBMITTED', 'GRADED', 'RETURNED'] as const
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES)
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>

const isoDateTime = z.string().datetime({ offset: true })

// ── Задание (преподаватель) ──────────────────────────────────────────────────
export const CreateAssignmentSchema = z
  .object({
    courseId: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(20000).optional(),
    type: AssignmentTypeSchema.default('HOMEWORK'),
    submissionType: SubmissionTypeSchema.default('TEXT'),
    maxScore: z.number().int().min(1).max(1000).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional(),
    allowLate: z.boolean().optional(),
    publishAt: isoDateTime.optional(),
    dueAt: isoDateTime.optional(),
  })
  .strict()
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>

export const UpdateAssignmentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(20000).nullable().optional(),
    type: AssignmentTypeSchema.optional(),
    submissionType: SubmissionTypeSchema.optional(),
    maxScore: z.number().int().min(1).max(1000).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
    allowLate: z.boolean().optional(),
    publishAt: isoDateTime.nullable().optional(),
    dueAt: isoDateTime.nullable().optional(),
  })
  .strict()
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>

export const AssignmentListQuerySchema = OffsetPaginationSchema.extend({
  courseId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  status: AssignmentStatusSchema.optional(),
  mine: z.coerce.boolean().optional(),
})
export type AssignmentListQueryInput = z.infer<typeof AssignmentListQuerySchema>

// ── Сдача (студент) ──────────────────────────────────────────────────────────
// Именование с префиксом Assignment — во избежание коллизии с documents.SaveSubmissionSchema.
export const SaveSubmissionDraftSchema = z
  .object({
    text: z.string().max(50000).nullable().optional(),
    linkUrl: z.string().url().max(2000).nullable().optional(),
  })
  .strict()
export type SaveSubmissionDraftInput = z.infer<typeof SaveSubmissionDraftSchema>

// ── Оценивание (преподаватель) ───────────────────────────────────────────────
export const GradeSubmissionSchema = z
  .object({
    score: z.number().int().min(0).max(1000),
    feedback: z.string().max(20000).optional(),
  })
  .strict()
export type GradeSubmissionInput = z.infer<typeof GradeSubmissionSchema>

export const ReturnSubmissionSchema = z
  .object({
    feedback: z.string().min(1).max(20000),
  })
  .strict()
export type ReturnSubmissionInput = z.infer<typeof ReturnSubmissionSchema>
