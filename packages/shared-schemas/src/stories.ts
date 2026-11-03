import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Сторисы (docs/PROJECT.md §3.4, задача Ф14.1). Значения enum дублируют Prisma-enum
// StoryAudience. Предметной (SUBJECT) аудитории здесь нет. Личные — FRIENDS (друзья автора)
// и SELECTED (поимённый список `userIds`). PARTNER_UNIVERSITIES — только у работодателя:
// студенты вузов, допустивших его компанию.

export const StoryAudienceSchema = z.enum([
  'ALL',
  'UNIVERSITY',
  'FACULTY',
  'GROUP',
  'TEACHERS',
  'FRIENDS',
  'SELECTED',
  'PARTNER_UNIVERSITIES',
])
export type StoryAudienceValue = z.infer<typeof StoryAudienceSchema>

/** Потолок списка SELECTED: сторис для узкого круга, а не рассылка. */
export const STORY_AUDIENCE_USERS_MAX = 100

const StoryAudienceUsersSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(STORY_AUDIENCE_USERS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Получатели повторяются' })

/** Поля аудитории — общие у публикации и у смены аудитории опубликованной сторис. */
const storyAudienceFields = {
  audience: StoryAudienceSchema,
  facultyId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  // Получатели — только для SELECTED (refine ниже).
  userIds: StoryAudienceUsersSchema.optional(),
}

function audienceUsersMatch(data: { audience: StoryAudienceValue; userIds?: string[] }): boolean {
  return data.audience === 'SELECTED' ? Boolean(data.userIds?.length) : !data.userIds
}
const AUDIENCE_USERS_MESSAGE = {
  message: 'Получатели указываются только для аудитории «выбранные»',
  path: ['userIds'],
}

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
// ── Медиа сторис ───────────────────────────────────────────────────────────────
// Форматы, которые сторис принимает. Размер и длительность — настройки сервера
// (STORY_IMAGE_MAX_MB, STORY_VIDEO_MAX_MB, STORY_VIDEO_MAX_SECONDS); клиент проверяет то же
// заранее, чтобы не грузить файл, который всё равно не пройдёт.
export const STORY_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const STORY_VIDEO_MIMES = ['video/mp4', 'video/webm'] as const
export const STORY_MEDIA_DEFAULTS = { imageMaxMb: 10, videoMaxMb: 100, videoMaxSeconds: 105 }

// ── Элементы кадра из редактора ───────────────────────────────────────────────
// Архитектура стикеров: дискриминированное объединение по `type`. Новый вид стикера —
// новая ветка объединения и её отрисовка; старые клиенты незнакомый тип пропускают.
export const STORY_ELEMENTS_MAX = 20
export const STORY_MENTIONS_MAX = 10
export const STORY_ELEMENT_TEXT_MAX = 200
export const STORY_FONTS = ['sans', 'serif', 'mono'] as const
export const STORY_TEXT_COLORS = [
  '#ffffff',
  '#0f1115',
  '#2b72e5',
  '#facc15',
  '#ef4444',
  '#22c55e',
] as const
export const STORY_TEXT_ALIGNS = ['left', 'center', 'right'] as const
export const STORY_TEXT_BACKGROUNDS = ['none', 'solid', 'soft'] as const

// Положение на кадре: доли ширины и высоты (0..1) — центр элемента; масштаб и поворот.
const storyPlacement = {
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.4).max(3),
  rotation: z.number().min(-180).max(180),
}

export const StoryTextElementSchema = z
  .object({
    type: z.literal('text'),
    ...storyPlacement,
    text: z.string().trim().min(1).max(STORY_ELEMENT_TEXT_MAX),
    color: z.enum(STORY_TEXT_COLORS),
    font: z.enum(STORY_FONTS),
    align: z.enum(STORY_TEXT_ALIGNS),
    background: z.enum(STORY_TEXT_BACKGROUNDS),
  })
  .strict()

export const StoryEmojiElementSchema = z
  .object({ type: z.literal('emoji'), ...storyPlacement, emoji: z.string().min(1).max(16) })
  .strict()

export const StoryMentionElementSchema = z
  .object({ type: z.literal('mention'), ...storyPlacement, userId: z.string().min(1) })
  .strict()

// Стикеры-карточки: ссылка на настоящую запись StudentHub. Хранится только id — данные
// (название, время, текст) сервер берёт при выдаче и только то, что видно зрителю.
export const STORY_CARDS_MAX = 3
export const STORY_CARD_TYPES = ['event', 'post', 'schedule'] as const

export const StoryEventElementSchema = z
  .object({ type: z.literal('event'), ...storyPlacement, eventId: z.string().min(1) })
  .strict()

export const StoryPostElementSchema = z
  .object({ type: z.literal('post'), ...storyPlacement, postId: z.string().min(1) })
  .strict()

// Пара расписания на конкретную дату (шаблон пары — без даты): «завтра в 14:00».
export const StoryScheduleElementSchema = z
  .object({
    type: z.literal('schedule'),
    ...storyPlacement,
    pairId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()

export const StoryElementSchema = z.discriminatedUnion('type', [
  StoryTextElementSchema,
  StoryEmojiElementSchema,
  StoryMentionElementSchema,
  StoryEventElementSchema,
  StoryPostElementSchema,
  StoryScheduleElementSchema,
])
export type StoryElementInput = z.infer<typeof StoryElementSchema>

export const CreateStorySchema = z
  .object({
    ...storyAudienceFields,
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
    elements: z.array(StoryElementSchema).max(STORY_ELEMENTS_MAX).optional(),
  })
  .strict()
  .refine(
    (data) =>
      new Set(data.elements?.filter((e) => e.type === 'mention').map((e) => e.userId)).size <=
      STORY_MENTIONS_MAX,
    { message: 'Слишком много упоминаний', path: ['elements'] },
  )
  .refine(
    (data) =>
      (data.elements ?? []).filter((e) => (STORY_CARD_TYPES as readonly string[]).includes(e.type))
        .length <= STORY_CARDS_MAX,
    { message: 'Слишком много карточек', path: ['elements'] },
  )
  // Содержимое — медиа, подпись или хотя бы один элемент редактора (текст на фоне).
  .refine((data) => Boolean(data.fileId) || Boolean(data.text) || Boolean(data.elements?.length), {
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
  .refine(audienceUsersMatch, AUDIENCE_USERS_MESSAGE)
export type CreateStoryInput = z.infer<typeof CreateStorySchema>

/**
 * Смена аудитории опубликованной сторис (только автор). Действует сразу: проверки видимости
 * читают аудиторию из записи при каждом запросе, кэша прав нет.
 */
export const UpdateStoryAudienceSchema = z
  .object(storyAudienceFields)
  .strict()
  .refine(audienceUsersMatch, AUDIENCE_USERS_MESSAGE)
export type UpdateStoryAudienceInput = z.infer<typeof UpdateStoryAudienceSchema>

/**
 * Реакции на сторис — только из белого списка, как у постов (POST_REACTION_EMOJIS).
 * Произвольная строка позволяла одному человеку поставить на сторис сколько угодно
 * «реакций» и раздуть сводку у всех зрителей. Набор — быстрые реакции просмотрщика: другого
 * способа реагировать на сторис у клиентов нет (мобильные сторис не показывают).
 */
export const STORY_REACTION_EMOJIS = ['❤️', '🔥', '👏', '😮', '😢'] as const
export type StoryReactionEmoji = (typeof STORY_REACTION_EMOJIS)[number]

export const StoryReactionSchema = z.object({ emoji: z.enum(STORY_REACTION_EMOJIS) }).strict()
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

// ── «Актуальное» (подборки сторис в профиле) ─────────────────────────────────

export const STORY_HIGHLIGHT_TITLE_MAX = 30
/** Подборок у одного автора и сторис в одной подборке — предохранители, не тариф. */
export const STORY_HIGHLIGHTS_MAX = 50
export const STORY_HIGHLIGHT_ITEMS_MAX = 100

const HighlightTitleSchema = z.string().trim().min(1).max(STORY_HIGHLIGHT_TITLE_MAX)

/** Подборка создаётся сразу с первой сторис: пустой подборки в профиле не бывает. */
export const CreateStoryHighlightSchema = z
  .object({ title: HighlightTitleSchema, storyId: z.string().min(1) })
  .strict()
export type CreateStoryHighlightInput = z.infer<typeof CreateStoryHighlightSchema>

/** Переименование и выбор обложки (элемент этой же подборки; null — первый элемент). */
export const UpdateStoryHighlightSchema = z
  .object({
    title: HighlightTitleSchema.optional(),
    coverItemId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine((data) => data.title !== undefined || data.coverItemId !== undefined, {
    message: 'Нечего менять',
    path: ['title'],
  })
export type UpdateStoryHighlightInput = z.infer<typeof UpdateStoryHighlightSchema>

export const AddStoryHighlightItemSchema = z.object({ storyId: z.string().min(1) }).strict()
export type AddStoryHighlightItemInput = z.infer<typeof AddStoryHighlightItemSchema>

/** Новый порядок — полный список id в нужной последовательности (подборок или элементов). */
export const ReorderStoryHighlightsSchema = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(Math.max(STORY_HIGHLIGHTS_MAX, STORY_HIGHLIGHT_ITEMS_MAX))
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Id повторяются' }),
  })
  .strict()
export type ReorderStoryHighlightsInput = z.infer<typeof ReorderStoryHighlightsSchema>

export const StoryHighlightsQuerySchema = z.object({ ownerId: z.string().min(1) }).strict()
export type StoryHighlightsQueryInput = z.infer<typeof StoryHighlightsQuerySchema>
