import { z } from 'zod'

// Справочник специальностей вуза (ведёт админ вуза). universityId берётся из scope, не из body.
export const CreateSpecialtySchema = z.object({ name: z.string().min(1).max(200) }).strict()
export type CreateSpecialtyInput = z.infer<typeof CreateSpecialtySchema>
