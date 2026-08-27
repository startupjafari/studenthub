import { z } from 'zod'

// Справочник КАТО — классификатор административно-территориальных объектов РК
// (docs/PROJECT.md §6.2). Общий для платформы, от вуза не зависит.

// Вид объекта. REGION/DISTRICT/ADMIN — административные уровни, остальные — населённые пункты.
export const KatoKindSchema = z.enum([
  'REGION',
  'DISTRICT',
  'ADMIN',
  'CITY',
  'SETTLEMENT',
  'VILLAGE',
  'STATION',
  'OTHER',
])
export type KatoKindValue = z.infer<typeof KatoKindSchema>

// Код КАТО: ровно 9 цифр. Он же первичный ключ справочника и то, что хранится
// в `University.city`.
export const KatoCodeSchema = z.string().regex(/^\d{9}$/, 'Код КАТО — 9 цифр')

// Пресеты вместо произвольного списка видов: выбор населённого пункта и выбор региона —
// два разных сценария, а перечислять виды в query-строке значило бы пускать наружу
// внутреннюю классификацию.
//   places  — населённые пункты (город, посёлок, село, станция, прочее)
//   regions — верхний уровень: 17 областей + 3 города республиканского значения
//   all     — включая районы и округа
export const KatoScopeSchema = z.enum(['places', 'regions', 'all']).default('places')
export type KatoScopeValue = z.infer<typeof KatoScopeSchema>

export const KatoSearchQuerySchema = z
  .object({
    search: z.string().min(1).max(100).optional(),
    scope: KatoScopeSchema,
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .strict()
export type KatoSearchQueryInput = z.infer<typeof KatoSearchQuerySchema>

// Резолв кодов в названия — для списков, где город уже сохранён (таблица вузов).
// Один запрос на весь список вместо запроса на строку; потолок 100 = размер страницы.
export const KatoResolveQuerySchema = z
  .object({
    codes: z
      .string()
      .min(1)
      .transform((v) => [...new Set(v.split(',').map((c) => c.trim()))].filter(Boolean))
      .pipe(z.array(KatoCodeSchema).min(1).max(100)),
  })
  .strict()
export type KatoResolveQueryInput = z.infer<typeof KatoResolveQuerySchema>

// Ответ. `regionNameRu/Kk` — подпись «Кокшетау, Акмолинская область»: строится по regionCode,
// который заполнен всегда, в отличие от parentCode (у 38 объектов иерархия в источнике битая).
export const KatoUnitSchema = z.object({
  code: KatoCodeSchema,
  kind: KatoKindSchema,
  nameRu: z.string(),
  nameKk: z.string(),
  regionCode: KatoCodeSchema,
  regionNameRu: z.string().nullable(),
  regionNameKk: z.string().nullable(),
})
export type KatoUnit = z.infer<typeof KatoUnitSchema>
