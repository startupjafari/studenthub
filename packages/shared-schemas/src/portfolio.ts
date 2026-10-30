import { z } from 'zod'
import { httpUrl } from './url.js'

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

// Потолок записей портфолио на пользователя: список отдаётся целиком, без пагинации, и
// резюме собирается из него же — бесконечный список здесь означал бы бесконечный ответ.
export const PORTFOLIO_MAX_ITEMS = 200

export const CreatePortfolioItemSchema = z
  .object({
    kind: PortfolioKindSchema,
    title: z.string().min(1).max(200),
    organization: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    url: httpUrl(500).optional(),
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
    url: httpUrl(500).nullish(),
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

// Порядок записей (`PUT /portfolio/order`): id своих записей в нужном порядке, первая — выше
// всех. Записи, которых нет в списке (добавлены с другого устройства, пока экран был открыт),
// встают после перечисленных, сохраняя свой порядок, — устаревший список не ломает перестановку.
export const ReorderPortfolioSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(PORTFOLIO_MAX_ITEMS)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be unique' }),
  })
  .strict()
export type ReorderPortfolioInput = z.infer<typeof ReorderPortfolioSchema>
