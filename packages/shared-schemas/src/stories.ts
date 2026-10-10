import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Сторисы (docs/PROJECT.md §3.4, задача Ф14.1). Значения enum дублируют Prisma-enum
// StoryAudience. Личной (PERSONAL) и предметной (SUBJECT) аудитории здесь нет: формат
// публичный, адресное сообщение одному человеку — это чат.

export const StoryAudienceSchema = z.enum(['ALL', 'UNIVERSITY', 'FACULTY', 'GROUP', 'TEACHERS'])
export type StoryAudienceValue = z.infer<typeof StoryAudienceSchema>

/**
 * Срок жизни сторис в часах. Значение одно на продукт и живёт здесь, а не в модуле:
 * его читают и сервер (ставит expiresAt), и клиент (показывает «осталось N ч»).
 * Связано с TTL-политикой бакета `stories-media` — менять их можно только вместе.
 */
export const STORY_TTL_HOURS = 24

/**
 * Фоны текстовой сторис — закрытый набор ключей, а не цвет от пользователя: значение
 * приходит из формы и попадает в `style` на клиенте. Что именно рисует каждый ключ,
 * знает веб (shared/ui), здесь — только список допустимого.
 */
export const STORY_BACKGROUNDS = ['sunset', 'ocean', 'forest', 'grape', 'graphite', 'rose'] as const
export type StoryBackgroundValue = (typeof STORY_BACKGROUNDS)[number]

/** Потолок текста. Сторис читают за секунды — это подпись, а не пост. */
export const STORY_TEXT_MAX = 600

/** Опрос в сторис: один вопрос, 2–4 варианта, одиночный выбор. */
export const StoryPollSchema = z
  .object({
    question: z.string().trim().min(1).max(200),
    options: z
      .array(z.string().trim().min(1).max(100))
      .min(2)
      .max(4)
      // Одинаковые варианты делают результат бессмысленным, а голос — неоднозначным.
      .refine((options) => new Set(options).size === options.length, {
        message: 'Варианты ответа не должны повторяться',
      }),
  })
  .strict()
export type StoryPollInput = z.infer<typeof StoryPollSchema>

/**
 * Создание сторис. Скоуп-цель (facultyId/groupId) проверяется сервисом по роли и
 * аудитории: значения из тела запроса — лишь пожелание, scope берётся из JWT автора.
 */
export const CreateStorySchema = z
  .object({
    audience: StoryAudienceSchema,
    facultyId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    // Идентификатор уже загруженного файла (бакет stories-media).
    fileId: z.string().min(1).optional(),
    text: z.string().trim().min(1).max(STORY_TEXT_MAX).optional(),
    background: z.enum(STORY_BACKGROUNDS).optional(),
    // Только http/https: javascript:-ссылка в сторис — это XSS через клик.
    linkUrl: z
      .string()
      .url()
      .max(500)
      .refine((url) => /^https?:\/\//i.test(url), { message: 'Ссылка должна быть http или https' })
      .optional(),
    linkLabel: z.string().trim().min(1).max(60).optional(),
    poll: StoryPollSchema.optional(),
  })
  .strict()
  .refine((data) => Boolean(data.fileId) || Boolean(data.text), {
    message: 'Сторис должна содержать медиа или текст',
    path: ['text'],
  })
  .refine((data) => !(data.background && data.fileId), {
    message: 'Фон выбирается только для текстовой сторис',
    path: ['background'],
  })
  .refine((data) => !(data.linkLabel && !data.linkUrl), {
    message: 'Подпись без ссылки',
    path: ['linkLabel'],
  })
export type CreateStoryInput = z.infer<typeof CreateStorySchema>

/** Реакция на сторис (как у поста и сообщения — эмодзи строкой). */
export const StoryReactionSchema = z.object({ emoji: z.string().min(1).max(16) }).strict()
export type StoryReactionInput = z.infer<typeof StoryReactionSchema>

/** Голос в опросе сторис. Выбор одиночный: повторный голос меняет прежний. */
export const StoryVoteSchema = z.object({ optionId: z.string().min(1) }).strict()
export type StoryVoteInput = z.infer<typeof StoryVoteSchema>

/**
 * Лента колец. Пагинации нет намеренно: выдача — живые сторисы за сутки, и их число
 * ограничено сроком жизни, а не историей. Потолок всё равно стоит на сервере (take).
 * authorId — сторисы одного автора (кольцо в профиле), всегда в пересечении с правами.
 */
export const StoriesFeedQuerySchema = z.object({ authorId: z.string().min(1).optional() }).strict()
export type StoriesFeedQueryInput = z.infer<typeof StoriesFeedQuerySchema>

/** Зрители сторис — список автору, cursor-пагинация (BACKEND_RULES §5.3). */
export const StoryViewersQuerySchema = CursorPaginationSchema
export type StoryViewersQueryInput = z.infer<typeof StoryViewersQuerySchema>
