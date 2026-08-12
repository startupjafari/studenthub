import { z } from 'zod'

// Аналитика декана (docs/ACADEMIC_CORE.md, задача 14) — read-only агрегаты по факультету.
export const FacultyAnalyticsQuerySchema = z
  .object({
    facultyId: z.string().min(1).optional(),
  })
  .strict()
export type FacultyAnalyticsQueryInput = z.infer<typeof FacultyAnalyticsQuerySchema>
