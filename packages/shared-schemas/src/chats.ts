import { z } from 'zod'
import { CursorPaginationSchema } from './pagination.js'

// Чаты (docs/PROJECT.md §3.6, §9; Ф9). ChatType дублирует Prisma-enum.

export const ChatTypeSchema = z.enum([
  'PRIVATE',
  'GROUP',
  'GROUP_OFFICIAL',
  'SUBJECT',
  'FACULTY',
  'DEAN',
  'SUPPORT',
  'EVENT',
  'SAVED',
])
export type ChatTypeValue = z.infer<typeof ChatTypeSchema>

// ── REST ─────────────────────────────────────────────────────────────────────

// Список чатов (cursor). Потолок страницы выше общего курсорного (50) намеренно: клиент
// забирает список целиком — по нему считаются вкладки-папки, счётчики и поиск по названиям, —
// и страница на 20 записей означала бы десяток запросов при каждом открытии экрана.
export const ChatListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(200).default(100),
  })
  .strict()
export type ChatListQueryInput = z.infer<typeof ChatListQuerySchema>

// Пользователь создаёт только PRIVATE/GROUP; официальные чаты создаются автоматически (§3.6).
export const CreateChatSchema = z
  .object({
    type: z.enum(['PRIVATE', 'GROUP']),
    title: z.string().min(1).max(150).optional(),
    memberIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict()
  // Личный чат — ровно один собеседник. Без этого сюда проходил список на 100 человек:
  // проверки createChat (блокировка, свой вуз, дружба, запрос на переписку) делались
  // только для первого не-себя, остальных добавляло молча, а дедупликация пары на такой
  // чат не срабатывала — каждый вызов плодил новый «личный» чат на четверых.
  .refine((v) => v.type !== 'PRIVATE' || v.memberIds.length === 1, {
    path: ['memberIds'],
    message: 'Личный чат создаётся ровно с одним собеседником',
  })
export type CreateChatInput = z.infer<typeof CreateChatSchema>

export const AddChatMemberSchema = z.object({ userId: z.string().min(1) }).strict()
export type AddChatMemberInput = z.infer<typeof AddChatMemberSchema>

// Изменение названия группы (Ф9+, только админ).
export const EditChatSchema = z.object({ title: z.string().min(1).max(150) }).strict()
export type EditChatInput = z.infer<typeof EditChatSchema>

// Черновик сообщения (Ф9+, синхронизация между устройствами). Пустой текст очищает черновик.
export const SaveDraftSchema = z.object({ text: z.string().max(4000) }).strict()
export type SaveDraftInput = z.infer<typeof SaveDraftSchema>

// История сообщений (cursor). Аддитивно (Этап 1, jump-to-message):
// - around — вернуть окно вокруг сообщения (до limit старее + целевое + до limit новее);
// - direction — направление курсорной подгрузки: older (по умолчанию, вверх) | newer (вниз, после jump).
export const ChatMessagesQuerySchema = CursorPaginationSchema.extend({
  around: z.string().min(1).optional(),
  // Переход по дате (#5): окно вокруг первого сообщения на/после этой даты (ISO datetime).
  aroundDate: z.string().datetime().optional(),
  direction: z.enum(['older', 'newer']).optional(),
})
export type ChatMessagesQueryInput = z.infer<typeof ChatMessagesQuerySchema>

// Дельта-догон после обрыва связи (docs/PROJECT.md §9): вернуть только изменения с позиции клиента.
// - since — последний применённый Message.seq; 0 означает «ничего не знаю, отдай всё с начала»;
// - sinceTs — время последней успешной синхронизации; без него правки/удаления не запрашиваются.
export const ChatUpdatesQuerySchema = z
  .object({
    since: z.coerce.number().int().min(0),
    sinceTs: z.string().datetime().optional(),
  })
  .strict()
export type ChatUpdatesQueryInput = z.infer<typeof ChatUpdatesQuerySchema>

// Поиск сообщений (Ф9+): по подстроке; chatId задан — внутри чата, иначе — по всем чатам участника.
// Фильтры (§4): senderId — только сообщения этого автора; hasFile — только с вложениями.
export const MessageSearchQuerySchema = CursorPaginationSchema.extend({
  q: z.string().trim().min(2).max(100),
  chatId: z.string().min(1).optional(),
  senderId: z.string().min(1).optional(),
  hasFile: z.coerce.boolean().optional(),
})
export type MessageSearchQueryInput = z.infer<typeof MessageSearchQuerySchema>

// Отключение уведомлений на время (§17): minutes — на сколько заглушить (нет/0 — «навсегда»).
// importantOnly — режим «только важные»: чат заглушён, но ответы на мои сообщения и упоминания
// меня по имени уведомление всё равно создают.
export const MuteSchema = z
  .object({
    minutes: z.coerce.number().int().positive().optional(),
    importantOnly: z.boolean().optional(),
  })
  .strict()
export type MuteInput = z.infer<typeof MuteSchema>

// ── Пользовательские папки чатов (§2) ───────────────────────────────────────────
// Встроенные вкладки («Личные», «Группы», …) считает клиент по типу чата; здесь — папки,
// которые человек собрал сам. Лимиты: список вкладок должен оставаться листаемым, а папка —
// осмысленной выборкой, а не «вторым списком всех чатов».
export const CHAT_FOLDER_LIMITS = {
  MAX_FOLDERS: 20,
  MAX_CHATS_PER_FOLDER: 200,
  NAME_MAX: 40,
} as const

export const CreateChatFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(CHAT_FOLDER_LIMITS.NAME_MAX),
    chatIds: z.array(z.string().min(1)).max(CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER).optional(),
  })
  .strict()
export type CreateChatFolderInput = z.infer<typeof CreateChatFolderSchema>

/** Правка папки: переименование и/или полная замена состава (не дельта — так проще на клиенте). */
export const UpdateChatFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(CHAT_FOLDER_LIMITS.NAME_MAX).optional(),
    chatIds: z.array(z.string().min(1)).max(CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER).optional(),
    position: z.coerce.number().int().min(0).max(CHAT_FOLDER_LIMITS.MAX_FOLDERS).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.chatIds !== undefined || v.position !== undefined, {
    message: 'Нужно передать хотя бы одно поле',
  })
export type UpdateChatFolderInput = z.infer<typeof UpdateChatFolderSchema>

// Опрос в чате (§38–39): вопрос + 2..10 вариантов + настройки.
export const CreateChatPollSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(10),
    multiple: z.boolean().optional(),
    anonymous: z.boolean().optional(),
    allowRevote: z.boolean().optional(),
    randomOrder: z.boolean().optional(),
  })
  .strict()
export type CreateChatPollInput = z.infer<typeof CreateChatPollSchema>

// Голос в опросе: optionIds — выбранные варианты (пустой массив = снять голос).
export const PollVoteSchema = z.object({ optionIds: z.array(z.string().min(1)).max(10) }).strict()
export type PollVoteInput = z.infer<typeof PollVoteSchema>

// Общие материалы чата (§23, правый sidebar): вложения по типу.
// media — фото/видео; file — документы/прочее; voice — аудио/голосовые.
export const ChatMediaQuerySchema = CursorPaginationSchema.extend({
  type: z.enum(['media', 'file', 'voice']).default('media'),
})
export type ChatMediaQueryInput = z.infer<typeof ChatMediaQuerySchema>

// Отправка сообщения с вложениями через REST (multipart): текст опционален, если есть файлы.
export const MessageSendRestSchema = z
  .object({
    chatId: z.string().min(1),
    content: z.string().max(4000).optional(),
    replyToId: z.string().min(1).optional(),
    // Ответ с цитатой фрагмента: выделенный кусок исходного сообщения. Хранится копией —
    // оригинал могут отредактировать, и смещения в тексте поехали бы. Без replyToId
    // бессмыслен: цитировать нечего.
    replyQuote: z.string().min(1).max(500).optional(),
    // §34: пометить все вложения сообщения спойлером (размытие до клика).
    spoiler: z.coerce.boolean().optional(),
    // multipart отдаёт поля строками, поэтому coerce (в отличие от WS-схемы ниже).
    silent: z.coerce.boolean().optional(),
  })
  .strict()
  // Цитата без ответа не имеет смысла — из чего цитата, непонятно ни серверу, ни клиенту.
  .refine((v) => !v.replyQuote || !!v.replyToId, {
    path: ['replyQuote'],
    message: 'Цитата возможна только вместе с ответом на сообщение',
  })
export type MessageSendRestInput = z.infer<typeof MessageSendRestSchema>

// Отложенное сообщение: только текст (вложения у отложенных не поддерживаются — файл
// пришлось бы держать в бакете без владельца-сообщения, и ночная чистка сирот удалила бы
// его до отправки). Время — строго в будущем и не дальше года.
export const ScheduleMessageSchema = z
  .object({
    content: z.string().min(1).max(4000),
    replyToId: z.string().min(1).optional(),
    replyQuote: z.string().min(1).max(500).optional(),
    silent: z.boolean().optional(),
    scheduledAt: z.string().datetime(),
  })
  .strict()
  .refine((v) => new Date(v.scheduledAt).getTime() > Date.now(), {
    path: ['scheduledAt'],
    message: 'Время отправки должно быть в будущем',
  })
  .refine((v) => new Date(v.scheduledAt).getTime() < Date.now() + 365 * 24 * 60 * 60 * 1000, {
    path: ['scheduledAt'],
    message: 'Отложить можно не больше чем на год',
  })
export type ScheduleMessageInput = z.infer<typeof ScheduleMessageSchema>

// Правка отложенного до отправки: текст и/или новое время.
export const UpdateScheduledMessageSchema = z
  .object({
    content: z.string().min(1).max(4000).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((v) => v.content !== undefined || v.scheduledAt !== undefined, {
    message: 'Нечего менять',
  })
  .refine((v) => !v.scheduledAt || new Date(v.scheduledAt).getTime() > Date.now(), {
    path: ['scheduledAt'],
    message: 'Время отправки должно быть в будущем',
  })
export type UpdateScheduledMessageInput = z.infer<typeof UpdateScheduledMessageSchema>

// Реакция-эмодзи на сообщение (Ф9+): тоггл по [сообщение, пользователь, эмодзи].
export const MessageReactionSchema = z.object({ emoji: z.string().min(1).max(16) }).strict()
export type MessageReactionInput = z.infer<typeof MessageReactionSchema>

// Пересылка сообщения в текущий чат (:id — цель): messageId — источник (из любого моего чата).
export const MessageForwardSchema = z.object({ messageId: z.string().min(1) }).strict()
export type MessageForwardInput = z.infer<typeof MessageForwardSchema>

// Поделиться постом в чат (:id — цель): postId — пост (должен быть виден отправителю),
// comment — необязательная подпись. В сообщении сохраняется sharedPostId → превью-карточка.
export const SharePostSchema = z
  .object({ postId: z.string().min(1), comment: z.string().max(4000).optional() })
  .strict()
export type SharePostInput = z.infer<typeof SharePostSchema>

// ── WebSocket payloads (валидируются той же схемой, что и REST — WS не доверенный, §10) ──

export const ChatJoinSchema = z.object({ chatId: z.string().min(1) }).strict()
export type ChatJoinInput = z.infer<typeof ChatJoinSchema>

export const MessageSendSchema = z
  .object({
    chatId: z.string().min(1),
    content: z.string().min(1).max(4000),
    replyToId: z.string().min(1).optional(),
    // Ответ с цитатой фрагмента: выделенный кусок исходного сообщения. Хранится копией —
    // оригинал могут отредактировать, и смещения в тексте поехали бы. Без replyToId
    // бессмыслен: цитировать нечего.
    replyQuote: z.string().min(1).max(500).optional(),
    // Отправить «без звука»: сообщение доставляется, уведомление и push по нему — нет.
    silent: z.boolean().optional(),
    // Клиентский идентификатор для оптимистичной отправки (#1): сервер эхом возвращает его в
    // message:new, чтобы отправитель заменил свой временный «pending» пузырь. В БД не пишется.
    nonce: z.string().min(1).max(64).optional(),
  })
  .strict()
  // Цитата без ответа не имеет смысла — из чего цитата, непонятно ни серверу, ни клиенту.
  .refine((v) => !v.replyQuote || !!v.replyToId, {
    path: ['replyQuote'],
    message: 'Цитата возможна только вместе с ответом на сообщение',
  })
export type MessageSendInput = z.infer<typeof MessageSendSchema>

export const MessageEditSchema = z
  .object({ messageId: z.string().min(1), content: z.string().min(1).max(4000) })
  .strict()
export type MessageEditInput = z.infer<typeof MessageEditSchema>

export const MessageDeleteSchema = z.object({ messageId: z.string().min(1) }).strict()
export type MessageDeleteInput = z.infer<typeof MessageDeleteSchema>

export const MessageReadSchema = z
  .object({ chatId: z.string().min(1), messageId: z.string().min(1) })
  .strict()
export type MessageReadInput = z.infer<typeof MessageReadSchema>

export const TypingSchema = z.object({ chatId: z.string().min(1) }).strict()
export type TypingInput = z.infer<typeof TypingSchema>

export const AuthRefreshSchema = z.object({ token: z.string().min(1) }).strict()
export type AuthRefreshInput = z.infer<typeof AuthRefreshSchema>
