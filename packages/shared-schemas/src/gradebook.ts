import { z } from 'zod'

// Журнал оценок (docs/ACADEMIC_CORE.md, задача 7). Тип колонки — строка (SSOT здесь).
export const GRADE_COLUMN_KINDS = ['LAB', 'CONTROL', 'EXAM', 'OTHER'] as const
export const GradeColumnKindSchema = z.enum(GRADE_COLUMN_KINDS)
export type GradeColumnKind = z.infer<typeof GradeColumnKindSchema>

export const CreateGradeColumnSchema = z
  .object({
    courseId: z.string().min(1),
    title: z.string().min(1).max(100),
    kind: GradeColumnKindSchema.default('OTHER'),
    maxScore: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
export type CreateGradeColumnInput = z.infer<typeof CreateGradeColumnSchema>

export const UpdateGradeColumnSchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    kind: GradeColumnKindSchema.optional(),
    maxScore: z.number().int().min(1).max(1000).nullable().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
export type UpdateGradeColumnInput = z.infer<typeof UpdateGradeColumnSchema>

// Массовое сохранение оценок одной колонки (inline-редактирование журнала).
export const SaveGradesSchema = z
  .object({
    columnId: z.string().min(1),
    entries: z
      .array(
        z
          .object({
            studentId: z.string().min(1),
            score: z.number().min(0).max(1000).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
export type SaveGradesInput = z.infer<typeof SaveGradesSchema>
