import { z } from 'zod'
import { httpUrl } from './url.js'

// Учебные материалы (docs/PROJECT.md §12 teacher/materials, Ф12).
export const CreateMaterialSchema = z
  .object({
    groupId: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    subject: z.string().min(1).max(200).optional(),
    url: httpUrl(1000).optional(),
  })
  .strict()
export type CreateMaterialInput = z.infer<typeof CreateMaterialSchema>

// Потолок одной выдачи списка материалов; дальше — по `cursor` (id последнего полученного).
export const MATERIAL_LIST_LIMIT = 200

// Флаг из query-строки. `z.coerce.boolean()` превратил бы строку "false" в true.
const queryFlag = z.enum(['true', 'false']).transform((v) => v === 'true')

export const MaterialListQuerySchema = z
  .object({
    groupId: z.string().min(1).optional(),
    // Только свои материалы (автор — смотрящий).
    mine: queryFlag.optional(),
    // Точное совпадение с `subject` материала — страница дисциплины.
    subject: z.string().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(MATERIAL_LIST_LIMIT).optional(),
  })
  .strict()
export type MaterialListQueryInput = z.infer<typeof MaterialListQuerySchema>

// Счётчики материалов по дисциплинам (карточки «Дисциплин»): считаются на сервере по всей
// выборке, а не по одной странице списка.
export const MaterialSubjectsQuerySchema = z
  .object({
    groupId: z.string().min(1).optional(),
    mine: queryFlag.optional(),
  })
  .strict()
export type MaterialSubjectsQueryInput = z.infer<typeof MaterialSubjectsQuerySchema>
