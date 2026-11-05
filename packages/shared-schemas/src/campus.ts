import { z } from 'zod'
import { COORD_LIMIT_MM, FloorPlanSchema, SitePlanSchema } from '@studenthub/campus-core'

// Кампус — Campus 3D Builder (docs/CAMPUS_BUILDER.md §18). Формат документов этажа и
// территории — в @studenthub/campus-core: одна схема для редактора, воркера и сервера.

const Mm = z.number().int().min(-COORD_LIMIT_MM).max(COORD_LIMIT_MM)
const Point = z.object({ x: Mm, y: Mm }).strict()

export const CampusOutlineSchema = z.array(Point).min(3).max(64)
export const CampusTransformSchema = z
  .object({ x: Mm, y: Mm, rotationDeg: z.number().min(-360).max(360) })
  .strict()
export const CampusGeoAnchorSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    bearingDeg: z.number().min(-360).max(360),
  })
  .strict()

export const CampusFloorKindSchema = z.enum(['regular', 'basement', 'technical'])

export const CreateCampusSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    // Платформе — обязателен; админу и модератору вуза — свой вуз из токена.
    universityId: z.string().uuid().optional(),
  })
  .strict()
export type CreateCampusInput = z.infer<typeof CreateCampusSchema>

export const UpdateCampusSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    geoAnchor: CampusGeoAnchorSchema.nullable().optional(),
  })
  .strict()
export type UpdateCampusInput = z.infer<typeof UpdateCampusSchema>

export const CreateCampusBuildingSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(10).optional(),
    outline: CampusOutlineSchema,
    transform: CampusTransformSchema.default({ x: 0, y: 0, rotationDeg: 0 }),
    floors: z
      .object({
        count: z.number().int().min(1).max(60),
        firstLevel: z.number().int().min(-5).max(100),
        heightMm: z.number().int().min(2_000).max(20_000),
      })
      .strict()
      .default({ count: 1, firstLevel: 1, heightMm: 3_300 }),
  })
  .strict()
export type CreateCampusBuildingInput = z.infer<typeof CreateCampusBuildingSchema>

export const UpdateCampusBuildingSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    code: z.string().trim().max(10).nullable().optional(),
    outline: CampusOutlineSchema.optional(),
    transform: CampusTransformSchema.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
export type UpdateCampusBuildingInput = z.infer<typeof UpdateCampusBuildingSchema>

export const CreateCampusFloorSchema = z
  .object({
    level: z.number().int().min(-5).max(100),
    label: z.string().trim().min(1).max(40).optional(),
    kind: CampusFloorKindSchema.optional(),
    heightMm: z.number().int().min(2_000).max(20_000).optional(),
    elevationMm: z.number().int().min(-50_000).max(500_000).optional(),
    // Копия существующего этажа того же корпуса (§12.7); номера — сдвигом префикса.
    copyFromFloorId: z.string().uuid().optional(),
    renumber: z
      .object({ from: z.string().trim().min(1).max(5), to: z.string().trim().min(1).max(5) })
      .strict()
      .optional(),
  })
  .strict()
export type CreateCampusFloorInput = z.infer<typeof CreateCampusFloorSchema>

export const UpdateCampusFloorSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    kind: CampusFloorKindSchema.optional(),
    heightMm: z.number().int().min(2_000).max(20_000).optional(),
    elevationMm: z.number().int().min(-50_000).max(500_000).optional(),
  })
  .strict()
export type UpdateCampusFloorInput = z.infer<typeof UpdateCampusFloorSchema>

/** Сохранение плана: ревизия, от которой шла правка, — для оптимистичной конкуренции. */
export const SaveCampusFloorPlanSchema = z
  .object({ baseRevision: z.number().int().min(0), document: FloorPlanSchema })
  .strict()
export type SaveCampusFloorPlanInput = z.infer<typeof SaveCampusFloorPlanSchema>

export const SaveCampusSitePlanSchema = z
  .object({ baseRevision: z.number().int().min(0), document: SitePlanSchema })
  .strict()
export type SaveCampusSitePlanInput = z.infer<typeof SaveCampusSitePlanSchema>

export const PublishCampusSchema = z
  .object({
    note: z.string().trim().max(500).optional(),
    // Ревизии этажей, которые редактор проверил перед публикацией: разошлись — 409.
    floorRevisions: z.record(z.string().uuid(), z.number().int().min(0)).optional(),
  })
  .strict()
export type PublishCampusInput = z.infer<typeof PublishCampusSchema>

export const CampusSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(100),
    campusId: z.string().uuid().optional(),
  })
  .strict()
export type CampusSearchInput = z.infer<typeof CampusSearchSchema>

export const CampusPresenceSchema = z.object({ force: z.boolean().optional() }).strict()
export type CampusPresenceInput = z.infer<typeof CampusPresenceSchema>
