import { z } from 'zod'
import { OffsetPaginationSchema } from './pagination.js'

// Дисциплины (docs/ACADEMIC_CORE.md, задача 2): Subject (справочник вуза), Term
// (семестр как сущность), Course (преподавание дисциплины группе в семестре).

// ── Term (семестр) ───────────────────────────────────────────────────────────
export const CreateTermSchema = z
  .object({
    universityId: z.string().min(1),
    name: z.string().min(1).max(120),
    number: z.number().int().min(1).max(20).optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, {
    message: 'endsOn must be on or after startsOn',
    path: ['endsOn'],
  })
export type CreateTermInput = z.infer<typeof CreateTermSchema>

export const UpdateTermSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    number: z.number().int().min(1).max(20).nullable().optional(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
export type UpdateTermInput = z.infer<typeof UpdateTermSchema>

export const TermListQuerySchema = z
  .object({
    universityId: z.string().min(1).optional(),
  })
  .strict()
export type TermListQueryInput = z.infer<typeof TermListQuerySchema>

// ── Subject (справочник дисциплин) ───────────────────────────────────────────
export const CreateSubjectSchema = z
  .object({
    universityId: z.string().min(1),
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(50).optional(),
  })
  .strict()
export type CreateSubjectInput = z.infer<typeof CreateSubjectSchema>

export const UpdateSubjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(50).nullable().optional(),
  })
  .strict()
export type UpdateSubjectInput = z.infer<typeof UpdateSubjectSchema>

export const SubjectListQuerySchema = z
  .object({
    universityId: z.string().min(1).optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .strict()
export type SubjectListQueryInput = z.infer<typeof SubjectListQuerySchema>

// ── Course (дисциплина группы в семестре) ────────────────────────────────────
export const CreateCourseSchema = z
  .object({
    subjectId: z.string().min(1),
    groupId: z.string().min(1),
    teacherId: z.string().min(1).optional(),
    termId: z.string().min(1).optional(),
    credits: z.number().int().min(0).max(60).optional(),
  })
  .strict()
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>

export const UpdateCourseSchema = z
  .object({
    teacherId: z.string().min(1).nullable().optional(),
    termId: z.string().min(1).nullable().optional(),
    credits: z.number().int().min(0).max(60).nullable().optional(),
  })
  .strict()
export type UpdateCourseInput = z.infer<typeof UpdateCourseSchema>

// Список дисциплин: пагинация + фильтры. `mine` — только свои (для преподавателя).
export const CourseListQuerySchema = OffsetPaginationSchema.extend({
  groupId: z.string().min(1).optional(),
  termId: z.string().min(1).optional(),
  teacherId: z.string().min(1).optional(),
  mine: z.coerce.boolean().optional(),
})
export type CourseListQueryInput = z.infer<typeof CourseListQuerySchema>
