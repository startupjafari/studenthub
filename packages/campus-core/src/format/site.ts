import { z } from 'zod'
import { COORD_LIMIT_MM } from './schema.js'

/**
 * Формат документа территории кампуса (docs/CAMPUS_BUILDER.md §10.5, §14). Координаты — целые
 * мм в системе кампуса. Корпуса сюда не входят: их положение — `transform` в таблице корпусов.
 * Подложек нет (решение владельца): территорию рисуют с нуля.
 */
export const SITE_PLAN_FORMAT = 1

const Id = z.string().min(1).max(40)
const Mm = z.number().int().min(-COORD_LIMIT_MM).max(COORD_LIMIT_MM)
const Point = z.object({ x: Mm, y: Mm }).strict()
const Polygon = z.array(Point).min(3).max(256)
const Name = z.string().trim().max(100).optional()

export const SITE_FEATURE_TYPES = [
  'path',
  'road',
  'lawn',
  'parking',
  'sport',
  'rest',
  'tree',
  'gate',
  'label',
] as const

export const SiteFeatureSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('path'),
      line: z.array(Point).min(2).max(256),
      widthMm: z.number().int().min(500).max(20_000),
      covered: z.boolean(),
      name: Name,
    })
    .strict(),
  z
    .object({
      type: z.literal('road'),
      line: z.array(Point).min(2).max(256),
      widthMm: z.number().int().min(2_000).max(40_000),
      name: Name,
    })
    .strict(),
  z.object({ type: z.literal('lawn'), polygon: Polygon, name: Name }).strict(),
  z.object({ type: z.literal('parking'), polygon: Polygon, name: Name }).strict(),
  z.object({ type: z.literal('sport'), polygon: Polygon, name: Name }).strict(),
  z.object({ type: z.literal('rest'), polygon: Polygon, name: Name }).strict(),
  z
    .object({ type: z.literal('tree'), x: Mm, y: Mm, variant: z.enum(['deciduous', 'conifer']) })
    .strict(),
  z
    .object({
      type: z.literal('gate'),
      x: Mm,
      y: Mm,
      widthMm: z.number().int().min(800).max(20_000),
      name: Name,
    })
    .strict(),
  z
    .object({ type: z.literal('label'), x: Mm, y: Mm, text: z.string().trim().min(1).max(200) })
    .strict(),
])

export const SitePlanSchema = z
  .object({
    format: z.literal(SITE_PLAN_FORMAT),
    boundary: z.array(Point).max(256),
    features: z
      .record(Id, SiteFeatureSchema)
      .refine((r) => Object.keys(r).length <= 5_000, { message: 'Слишком много объектов' }),
  })
  .strict()

export type SiteFeature = z.infer<typeof SiteFeatureSchema>
export type SitePlanDoc = z.infer<typeof SitePlanSchema>

export function emptySitePlan(): SitePlanDoc {
  return { format: SITE_PLAN_FORMAT, boundary: [], features: {} }
}
