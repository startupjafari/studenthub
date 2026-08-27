import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Посты и лента (docs/PROJECT.md §3.3, Ф8). Значение enum дублирует Prisma-enum PostAudience.

export const PostAudienceSchema = z.enum([
  'ALL',
  'UNIVERSITY',
  'FACULTY',
  'GROUP',
  'SUBJECT',
  'TEACHERS',
  'PERSONAL',
])
export type PostAudienceValue = z.infer<typeof PostAudienceSchema>

// Создание поста. Скоуп-цель (facultyId/groupId/targetUserId/subject) валидируется сервисом
// по роли и audience; лишние поля для неподходящей audience игнорируются.
export const CreatePostSchema = z
  .object({
    audience: PostAudienceSchema,
    // Заголовок необязателен: короткой заметке он не нужен, а объявление без него
    // не находится глазами в потоке ленты.
    title: z.string().min(1).max(200).optional(),
    // Текст в ограниченном markdown (жирный, курсив, зачёркнутый, код, ссылки,
    // списки, цитата). Разметка хранится как есть и разбирается на клиенте.
    content: z.string().min(1).max(5000),
    facultyId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
    subject: z.string().min(1).max(200).optional(),
    // Идентификаторы уже загруженных файлов (бакет posts-media) для привязки к посту.
    mediaIds: z.array(z.string().min(1)).max(10).optional(),
    // Черновик / отложенная публикация: DRAFT — сохранить без публикации; PUBLISHED — сразу.
    // scheduledAt в будущем → пост становится отложенным (крон опубликует).
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    scheduledAt: z.coerce.date().optional().nullable(),
  })
  .strict()
export type CreatePostInput = z.infer<typeof CreatePostSchema>

// Репост: контент-комментарий необязателен; audience/цель — как у обычного поста.
export const RepostSchema = z
  .object({
    audience: PostAudienceSchema,
    content: z.string().max(5000).optional(),
    facultyId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  })
  .strict()
export type RepostInput = z.infer<typeof RepostSchema>

export const CreateCommentSchema = z
  .object({
    content: z.string().min(1).max(2000),
    parentId: z.string().min(1).optional(),
  })
  .strict()
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>

export const ReactionSchema = z.object({ emoji: z.string().min(1).max(16) }).strict()
export type ReactionInput = z.infer<typeof ReactionSchema>

// Закрепление/открепление поста (задача 8.6).
export const PinPostSchema = z.object({ pinned: z.boolean() }).strict()
export type PinPostInput = z.infer<typeof PinPostSchema>

// Табы ленты (Ф8+): фильтр всегда пересекается с видимостью зрителя на сервере.
// ALL — без фильтра; GROUP/UNIVERSITY/TEACHERS — по audience поста; IMPORTANT — закреплённые.
export const FeedFilterSchema = z.enum(['ALL', 'GROUP', 'UNIVERSITY', 'TEACHERS', 'IMPORTANT'])
export type FeedFilterValue = z.infer<typeof FeedFilterSchema>

// Лента — cursor-пагинация (docs/BACKEND_RULES.md §5.3, take ≤ 50).
// authorId — опциональный фильтр по автору (вкладка «Посты» в профиле); всегда пересекается
// с видимостью зрителя на сервере (нельзя увидеть чужие посты в обход прав).
// filter — таб ленты; сужает выдачу поверх видимости (нельзя увидеть скрытое в обход прав).
export const FeedQuerySchema = CursorPaginationSchema.extend({
  authorId: z.string().min(1).optional(),
  filter: FeedFilterSchema.optional(),
})
export type FeedQueryInput = z.infer<typeof FeedQuerySchema>
