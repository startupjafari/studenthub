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

// Правка своей публикации. Аудиторию и вложения не трогаем: смена аудитории меняет
// круг тех, кто пост уже видел, а подмена вложений после публикации — совсем другой
// пост. Меняются только заголовок и текст.
export const UpdatePostSchema = z
  .object({
    title: z.string().max(200).optional().nullable(),
    content: z.string().min(1).max(5000).optional(),
  })
  .strict()
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>

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

// Реакции на пост — только из белого списка. Произвольная строка позволяла одному человеку
// поставить на пост сколько угодно «реакций» (`a1`, `a2`, …): счётчик накручивался, а ответ
// ленты раздувался у всех читателей. В списке всё, что ставят клиенты (веб — ❤️, iOS и
// Android — 👍 🔥 ❤️), и то, что уже лежит в данных стенда (prisma/seed: 👏 😮 🎉).
export const POST_REACTION_EMOJIS = ['❤️', '👍', '🔥', '👏', '😮', '🎉'] as const
export type PostReactionEmoji = (typeof POST_REACTION_EMOJIS)[number]

export const ReactionSchema = z.object({ emoji: z.enum(POST_REACTION_EMOJIS) }).strict()
export type ReactionInput = z.infer<typeof ReactionSchema>

// Сводка реакций поста в ответе API (`reactionSummary`): сколько каждой и стоит ли среди
// них своя. Только реакции из белого списка; порядок — как в POST_REACTION_EMOJIS.
export interface PostReactionSummary {
  emoji: string
  count: number
  mine: boolean
}

// Закрепление/открепление поста (задача 8.6).
export const PinPostSchema = z.object({ pinned: z.boolean() }).strict()
export type PinPostInput = z.infer<typeof PinPostSchema>

// Табы ленты (Ф8+): фильтр всегда пересекается с видимостью зрителя на сервере.
// ALL — без фильтра; GROUP/UNIVERSITY/TEACHERS — по audience поста; IMPORTANT — закреплённые.
// SAVED — личная полка: посты, которые зритель сам сохранил. Он единственный, кто её видит,
// и отдельной ручки для неё нет намеренно — это тот же список с тем же правом видеть.
// MODERATION — не срез личной ленты, а всё, что роль вправе снимать: платформа — все вузы,
// админ и модератор вуза — свой вуз, декан — свой факультет (без личных постов). Только
// для ролей модерации, остальным — FORBIDDEN.
export const FeedFilterSchema = z.enum([
  'ALL',
  'GROUP',
  'UNIVERSITY',
  'TEACHERS',
  'IMPORTANT',
  'SAVED',
  'MODERATION',
])
export type FeedFilterValue = z.infer<typeof FeedFilterSchema>

// Лента — cursor-пагинация (docs/BACKEND_RULES.md §5.3, take ≤ 50).
// authorId — опциональный фильтр по автору (вкладка «Посты» в профиле); всегда пересекается
// с видимостью зрителя на сервере (нельзя увидеть чужие посты в обход прав).
// filter — таб ленты; сужает выдачу поверх видимости (нельзя увидеть скрытое в обход прав).
// reactions — форма реакций в выдаче. `list` (по умолчанию, как было) — построчный
// `reactions` «кто что поставил» рядом со сводкой `reactionSummary`; на популярном посте это
// тысячи строк ради одного числа. `summary` — только сводка: так ходит клиент, который
// читает `reactionSummary` (веб); мобильные клиенты, считающие по строкам, ничего не шлют.
export const FeedQuerySchema = CursorPaginationSchema.extend({
  authorId: z.string().min(1).optional(),
  filter: FeedFilterSchema.optional(),
  reactions: z.enum(['list', 'summary']).optional(),
})
export type FeedQueryInput = z.infer<typeof FeedQuerySchema>
