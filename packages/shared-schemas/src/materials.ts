import { z } from 'zod'

// Учебные материалы (docs/PROJECT.md §12 teacher/materials, Ф12).
export const CreateMaterialSchema = z
  .object({
    groupId: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    subject: z.string().min(1).max(200).optional(),
    url: z.string().url().max(1000).optional(),
  })
  .strict()
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>

export const MaterialListQuerySchema = z.object({ groupId: z.string().min(1).optional() }).strict()
export type MaterialListQueryInput = z.infer<typeof MaterialListQuerySchema>
