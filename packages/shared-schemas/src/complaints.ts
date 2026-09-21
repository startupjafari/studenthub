import { z } from 'zod'
import { AdminLimitSchema, OffsetPaginationSchema, SortOrderSchema } from './pagination.js'

// Жалобы (docs/PROJECT.md §11, Ф11). Enum'ы дублируют Prisma ComplaintTargetType/ComplaintStatus.
export const ComplaintTargetTypeSchema = z.enum(['POST', 'STORY', 'COMMENT', 'MESSAGE', 'USER'])
export type ComplaintTargetTypeValue = z.infer<typeof ComplaintTargetTypeSchema>

export const ComplaintStatusSchema = z.enum(['PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED'])
export type ComplaintStatusValue = z.infer<typeof ComplaintStatusSchema>

// Приоритет очереди модерации. Дублирует Prisma ComplaintPriority; порядок значений —
// порядок разбора (HIGH первым), на нём же держится ORDER BY priority ASC на сервере.
export const ComplaintPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW'])
export type ComplaintPriorityValue = z.infer<typeof ComplaintPrioritySchema>

/**
 * Приоритет жалобы по категории цели — одно правило для API (пишет в БД при создании) и
 * для UI (объясняет пользователю, откуда приоритет).
 *
 * HIGH — жалоба на человека и на личные сообщения: страдает конкретный человек
 * (травля, угрозы, спам в личку), и без модератора он защититься не может.
 * MEDIUM — публичный контент (пост, история): виден многим, но не направлен на одного
 * человека, и история к тому же исчезает сама.
 * LOW — комментарий: локальная реплика под чужим контентом.
 */
export const COMPLAINT_PRIORITY_BY_TARGET: Record<
  ComplaintTargetTypeValue,
  ComplaintPriorityValue
> = {
  USER: 'HIGH',
  MESSAGE: 'HIGH',
  POST: 'MEDIUM',
  STORY: 'MEDIUM',
  COMMENT: 'LOW',
}

export function complaintPriorityFor(target: ComplaintTargetTypeValue): ComplaintPriorityValue {
  return COMPLAINT_PRIORITY_BY_TARGET[target]
}

export const CreateComplaintSchema = z
  .object({
    targetType: ComplaintTargetTypeSchema,
    targetId: z.string().min(1),
    reason: z.string().min(1).max(2000),
  })
  .strict()
export type CreateComplaintInput = z.infer<typeof CreateComplaintSchema>

// Действие модератора при разрешении жалобы (задача 11.4).
export const ResolveComplaintSchema = z
  .object({
    /**
     * `WARN_USER` — промежуточная мера: человеку уходит уведомление, запись остаётся в
     * модерации навсегда. До неё шкала шла от «нарушения нет» сразу к блокировке, и на
     * первый грубый комментарий приходилось выбирать между «ничего» и отключением.
     */
    action: z.enum(['DELETE_CONTENT', 'BLOCK_USER', 'WARN_USER', 'DISMISS']),
    comment: z.string().max(2000).optional(),
    /**
     * Применить решение ко ВСЕМ необработанным жалобам на ту же цель.
     *
     * Десять жалоб на один пост — обычное дело, и разбирать их по одной значит десять раз
     * прочитать одно и то же. Побочное действие (снять контент, заблокировать) при этом
     * выполняется РОВНО ОДИН раз: остальные жалобы просто получают тот же статус.
     */
    applyToDuplicates: z.boolean().optional(),
    /**
     * Срок блокировки в днях (только для `BLOCK_USER`). Без него блокировка бессрочная —
     * как была. Потолок в 365 дней: всё, что дольше года, по смыслу и есть «навсегда»,
     * и промах в поле ввода не должен создавать блокировку до 2147 года.
     */
    blockDays: z.number().int().min(1).max(365).optional(),
    /** Код 2FA. Обязателен только из мини-аппа (ActionConfirmGuard). */
    code: z.string().trim().min(6).max(16).optional(),
  })
  .strict()
export type ResolveComplaintInput = z.infer<typeof ResolveComplaintSchema>

/**
 * Тело `POST /complaints/from-support`: обращение и человек, на которого жалуются.
 *
 * Тип цели здесь не спрашивается: через поддержку жалуются на людей. На конкретный пост
 * или сообщение есть кнопка рядом с самим постом, и она приносит targetId, которого
 * в переписке с поддержкой всё равно нет.
 */
export const ComplaintFromSupportSchema = z
  .object({
    chatId: z.string().min(1),
    targetId: z.string().min(1),
  })
  .strict()
export type ComplaintFromSupportInput = z.infer<typeof ComplaintFromSupportSchema>

/**
 * Тело `PATCH /users/:id/block`: срок и код 2FA — оба необязательны.
 *
 * `.default({})` не украшение: веб блокирует запросом вообще без тела (кода он не
 * спрашивает — человек прошёл пароль и 2FA в той же сессии), и схема без дефолта
 * отвечала бы ему 400 на «Заблокировать».
 */
export const BlockUserSchema = z
  .object({
    blockDays: z.number().int().min(1).max(365).optional(),
    code: z.string().trim().min(6).max(16).optional(),
  })
  .strict()
  .default({})
export type BlockUserInput = z.infer<typeof BlockUserSchema>

// Колонки таблицы жалоб, по которым разрешена сортировка.
export const COMPLAINT_SORT_FIELDS = ['priority', 'createdAt', 'status', 'targetType'] as const
export const ComplaintSortSchema = z.enum(COMPLAINT_SORT_FIELDS)
export type ComplaintSortValue = z.infer<typeof ComplaintSortSchema>

// Очередь модерации: фильтры по статусу и приоритету, offset-пагинация (20…200),
// сортировка по всей выборке. Порядок по умолчанию — очередь: сначала необработанные,
// внутри — по приоритету, внутри — свежие раньше.
export const ComplaintListQuerySchema = OffsetPaginationSchema.extend({
  /**
   * Все жалобы на одну цель — история по нарушителю или по посту. Единичная обида и
   * травля в очереди выглядят одинаково; разводит их только список прошлых разборов.
   */
  targetId: z.string().min(1).max(64).optional(),
  status: ComplaintStatusSchema.optional(),
  priority: ComplaintPrioritySchema.optional(),
  sort: ComplaintSortSchema.optional(),
  order: SortOrderSchema.optional(),
  limit: AdminLimitSchema,
})
export type ComplaintListQueryInput = z.infer<typeof ComplaintListQuerySchema>
