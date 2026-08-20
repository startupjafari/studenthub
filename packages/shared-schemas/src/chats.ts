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

// Пользователь создаёт только PRIVATE/GROUP; официальные чаты создаются автоматически (§3.6).
export const CreateChatSchema = z
  .object({
    type: z.enum(['PRIVATE', 'GROUP']),
    title: z.string().min(1).max(150).optional(),
    memberIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict()
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
export const MuteSchema = z
  .object({ minutes: z.coerce.number().int().positive().optional() })
  .strict()
export type MuteInput = z.infer<typeof MuteSchema>

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
    // §34: пометить все вложения сообщения спойлером (размытие до клика).
    spoiler: z.coerce.boolean().optional(),
  })
  .strict()
export type MessageSendRestInput = z.infer<typeof MessageSendRestSchema>

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
    // Клиентский идентификатор для оптимистичной отправки (#1): сервер эхом возвращает его в
    // message:new, чтобы отправитель заменил свой временный «pending» пузырь. В БД не пишется.
    nonce: z.string().min(1).max(64).optional(),
  })
  .strict()
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
