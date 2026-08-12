import { z } from 'zod'

// Портфолио (docs/ACADEMIC_CORE.md, задача 21). Вид записи и видимость — строки (SSOT здесь).
export const PORTFOLIO_KINDS = [
  'EDUCATION',
  'EXPERIENCE',
  'PROJECT',
  'CERTIFICATE',
  'ACHIEVEMENT',
] as const
export const PortfolioKindSchema = z.enum(PORTFOLIO_KINDS)
export type PortfolioKind = z.infer<typeof PortfolioKindSchema>

// Приватность записи: только владелец / внутри вуза / публично.
export const PORTFOLIO_VISIBILITY = ['PRIVATE', 'UNIVERSITY', 'PUBLIC'] as const
export const PortfolioVisibilitySchema = z.enum(PORTFOLIO_VISIBILITY)
export type PortfolioVisibility = z.infer<typeof PortfolioVisibilitySchema>

const isoDate = z.string().datetime({ offset: true })

export const CreatePortfolioItemSchema = z
  .object({
    kind: PortfolioKindSchema,
    title: z.string().min(1).max(200),
    organization: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    url: z.string().url().max(500).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    visibility: PortfolioVisibilitySchema.optional(),
  })
  .strict()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })
export type CreatePortfolioItemInput = z.infer<typeof CreatePortfolioItemSchema>

export const UpdatePortfolioItemSchema = z
  .object({
    kind: PortfolioKindSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    organization: z.string().max(200).nullish(),
    description: z.string().max(2000).nullish(),
    url: z.string().url().max(500).nullish(),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    visibility: PortfolioVisibilitySchema.optional(),
  })
  .strict()
  // Проверяем порядок дат только когда обе присланы непустыми.
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })
export type UpdatePortfolioItemInput = z.infer<typeof UpdatePortfolioItemSchema>
