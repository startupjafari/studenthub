import { z } from 'zod'

// Контент профиля: статьи (расширенные) и опросы. Медиа (фото/видео) грузятся файлами.

// ── Статьи ──────────────────────────────────────────────────────────────────
export const ARTICLE_CATEGORIES = [
  'STUDY',
  'SCIENCE',
  'STUDENT_LIFE',
  'PROJECTS',
  'INTERNSHIPS',
  'CAREER',
  'EVENTS',
  'RESOURCES',
] as const
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number]

// Область видимости — общая для статей и опросов.
export const CONTENT_VISIBILITY = ['ALL', 'UNIVERSITY', 'FACULTY', 'GROUP'] as const
export type ContentVisibility = (typeof CONTENT_VISIBILITY)[number]

export const CreateProfileArticleSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(300).optional(),
    content: z.string().min(1).max(20000),
    // Обложка: загруженное изображение (coverUrl) ИЛИ пресет-градиент (coverGradient) ИЛИ авто (оба пусты).
    coverUrl: z.string().max(1000).optional(),
    coverGradient: z.string().max(20).optional(),
    category: z.enum(ARTICLE_CATEGORIES).optional(),
    tags: z.array(z.string().min(1).max(40)).max(15).optional(),
    visibility: z.enum(CONTENT_VISIBILITY).default('ALL'),
    allowComments: z.boolean().default(true),
    status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
  })
  .strict()
export type CreateProfileArticleInput = z.infer<typeof CreateProfileArticleSchema>

export const UpdateProfileArticleSchema = CreateProfileArticleSchema
export type UpdateProfileArticleInput = z.infer<typeof UpdateProfileArticleSchema>

// ── Опросы ────────────────────────────────────────────────────────────────────
export const POLL_RESULTS_VISIBILITY = ['AFTER_VOTE', 'AFTER_END', 'HIDDEN'] as const
export type PollResultsVisibility = (typeof POLL_RESULTS_VISIBILITY)[number]

export const CreatePollSchema = z
  .object({
    question: z.string().min(1).max(150),
    options: z.array(z.string().min(1).max(120)).min(2).max(10),
    multiple: z.boolean().default(false),
    anonymous: z.boolean().default(true),
    allowRevote: z.boolean().default(false),
    resultsVisibility: z.enum(POLL_RESULTS_VISIBILITY).default('AFTER_VOTE'),
    visibility: z.enum(CONTENT_VISIBILITY).default('ALL'),
    status: z.enum(['DRAFT', 'PUBLISHED']).default('PUBLISHED'),
    closesAt: z.coerce.date().optional().nullable(),
  })
  .strict()
export type CreatePollInput = z.infer<typeof CreatePollSchema>

export const UpdatePollSchema = CreatePollSchema
export type UpdatePollInput = z.infer<typeof UpdatePollSchema>

export const VotePollSchema = z
  .object({
    optionIds: z.array(z.string().min(1)).min(1).max(10),
  })
  .strict()
export type VotePollInput = z.infer<typeof VotePollSchema>

// ── Presigned-загрузка крупных медиа (видео >10МБ) напрямую в MinIO ────────────
const MAX_MEDIA_BYTES = 100 * 1024 * 1024 // 100 МБ (видео)

export const PresignProfileMediaSchema = z
  .object({
    mime: z.string().min(1).max(100),
    size: z.coerce.number().int().positive().max(MAX_MEDIA_BYTES),
  })
  .strict()
export type PresignProfileMediaInput = z.infer<typeof PresignProfileMediaSchema>

export const ConfirmProfileMediaSchema = z
  .object({
    key: z.string().min(1).max(300),
    mime: z.string().min(1).max(100),
  })
  .strict()
export type ConfirmProfileMediaInput = z.infer<typeof ConfirmProfileMediaSchema>

// ── Альбомы фото профиля ──────────────────────────────────────────────────────
export const CreateAlbumSchema = z.object({ title: z.string().min(1).max(100) }).strict()
export type CreateAlbumInput = z.infer<typeof CreateAlbumSchema>

export const UpdateAlbumSchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    // coverFileId: id файла-обложки (должен принадлежать альбому) или null — снять обложку.
    coverFileId: z.string().min(1).nullable().optional(),
  })
  .strict()
export type UpdateAlbumInput = z.infer<typeof UpdateAlbumSchema>

export const AssignAlbumMediaSchema = z
  .object({ fileIds: z.array(z.string().min(1)).min(1).max(50) })
  .strict()
export type AssignAlbumMediaInput = z.infer<typeof AssignAlbumMediaSchema>

// ── Комментарии к контенту профиля (статьи/опросы) ────────────────────────────
export const ContentCommentSchema = z.object({ content: z.string().min(1).max(2000) }).strict()
export type ContentCommentInput = z.infer<typeof ContentCommentSchema>
