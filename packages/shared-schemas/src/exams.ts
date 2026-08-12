import { z } from 'zod'

// Экзамены (docs/ACADEMIC_CORE.md, задача 11). Формат/статус — строки (SSOT здесь).
export const EXAM_FORMATS = ['ORAL', 'WRITTEN', 'TEST', 'PROJECT', 'OTHER'] as const
export const ExamFormatSchema = z.enum(EXAM_FORMATS)
export type ExamFormat = z.infer<typeof ExamFormatSchema>

export const EXAM_RESULT_STATUSES = ['SCHEDULED', 'PASSED', 'FAILED', 'ABSENT', 'RETAKE'] as const
export const ExamResultStatusSchema = z.enum(EXAM_RESULT_STATUSES)
export type ExamResultStatus = z.infer<typeof ExamResultStatusSchema>

const isoDateTime = z.string().datetime({ offset: true })

export const CreateExamSchema = z
  .object({
    courseId: z.string().min(1),
    date: isoDateTime,
    format: ExamFormatSchema.default('WRITTEN'),
    roomId: z.string().min(1).optional(),
    examinerId: z.string().min(1).optional(),
    maxScore: z.number().int().min(1).max(1000).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict()
export type CreateExamInput = z.infer<typeof CreateExamSchema>

export const UpdateExamSchema = z
  .object({
    date: isoDateTime.optional(),
    format: ExamFormatSchema.optional(),
    roomId: z.string().min(1).nullable().optional(),
    examinerId: z.string().min(1).nullable().optional(),
    maxScore: z.number().int().min(1).max(1000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
export type UpdateExamInput = z.infer<typeof UpdateExamSchema>

export const ExamListQuerySchema = z
  .object({
    groupId: z.string().min(1).optional(),
    courseId: z.string().min(1).optional(),
    mine: z.coerce.boolean().optional(),
  })
  .strict()
export type ExamListQueryInput = z.infer<typeof ExamListQuerySchema>

// Массовое проставление допуска/результатов экзамена (декан/экзаменатор).
export const SetExamResultsSchema = z
  .object({
    examId: z.string().min(1),
    entries: z
      .array(
        z
          .object({
            studentId: z.string().min(1),
            admitted: z.boolean(),
            status: ExamResultStatusSchema,
            score: z.number().min(0).max(1000).nullable().optional(),
            note: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
export type SetExamResultsInput = z.infer<typeof SetExamResultsSchema>
