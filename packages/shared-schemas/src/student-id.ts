import { z } from 'zod'

// Цифровой студенческий (docs/ACADEMIC_CORE.md, задача 20). Верификация личности по QR:
// сотрудник открывает /verify-id?t=… и подтверждает подлинность карты студента.
export const VerifyStudentIdSchema = z
  .object({
    token: z.string().min(1).max(2000),
  })
  .strict()
export type VerifyStudentIdInput = z.infer<typeof VerifyStudentIdSchema>
