import { z } from 'zod'
import { CursorPaginationSchema, queryBoolean } from './pagination.js'
import { vm } from './validation-messages.js'

// Чаты (docs/PROJECT.md §3.6, §9; Ф9). ChatType дублирует Prisma-enum.

export const ChatTypeSchema = z.enum([
  'PRIVATE',
  'GROUP',
  'GROUP_OFFICIAL',
  'SUBJECT',
  'FACULTY',
  'DEAN',
  'SUPPORT',
  'SUPPORT_PLATFORM',
  'EVENT',
  'SAVED',
])
export type ChatTypeValue = z.infer<typeof ChatTypeSchema>

/**
 * Текст сообщения: нормализуем ДО проверки длины.
 *
 * Без этого «пустое» сообщение проходило в обход интерфейса. Композер сам делает `trim()`
 * перед отправкой, и в браузере правило соблюдалось, но по WS напрямую уезжали и строка из
 * одних пробелов, и один U+200B, и три перевода строки: `min(1)` считает их непустыми, а
 * обрезки в схеме не было. REST-путь обрезал текст сам (`sendMessageRest`), WS-путь — нет,
 * и два пути расходились в поведении.
 *
 * Чиним в схеме, а не в сервисе: она общая для REST, WS и отложенной отправки, поэтому
 * правило перестаёт зависеть от того, каким путём пришло сообщение.
 *
 * Невидимые символы `trim()` не берёт — вырезаем их отдельно: нулевой ширины пробелы
 * (U+200B–U+200D), word joiner (U+2060), BOM (U+FEFF) и знак замены объекта (U+FFFC):
 * его оставляет на месте картинки или вложения вставка из буфера iOS, и «сообщение» из одного
 * U+FFFC приходило пустым квадратиком. Длина считается уже по очищенному тексту: сообщение
 * из 4000 символов и пробелов по краям отклонять незачем.
 */
const INVISIBLE_RE = /[\u200b-\u200d\u2060\ufeff\ufffc]/g

const messageText = (max = 4000) =>
  z
    .string()
    .transform((v) => v.replace(INVISIBLE_RE, '').trim())
    .pipe(z.string().min(1, vm('validation.chats.emptyMessage')).max(max))

/** То же, но текст необязателен: у сообщения с вложениями его может не быть вовсе. */
const optionalMessageText = (max = 4000) =>
  z
    .string()
    .transform((v) => v.replace(INVISIBLE_RE, '').trim())
    .pipe(z.string().max(max))
    .optional()

// ── REST ─────────────────────────────────────────────────────────────────────

/**
 * Ключ повтора отправки (nonce): клиент шлёт его с сообщением и повторяет при переотправке
 * после обрыва. Сервер помнит nonce 10 минут и на повтор возвращает уже созданное сообщение.
 */
export const CHAT_NONCE_MAX = 64

/**
 * id сообщений и чатов во входных данных. Не `.uuid()`: у сгенерированных сидом строк id
 * читаемые (`u042-…-msg-7`), а не UUID, и строгая проверка закрыла бы их для пересылки и
 * скрытия. Длина ограничена — это всё ещё ключ, а не текст.
 */
const entityId = z.string().min(1).max(100)

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

/**
 * Потолок описания группы. Тысяча знаков — это правила чата, пара ссылок и список админов,
 * то есть всё, ради чего описание заводят; дальше начинается документ, которому место в
 * закреплённом сообщении, а не в шапке.
 */
export const CHAT_DESCRIPTION_MAX = 1000

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
    message: vm('validation.chats.privateOneMember'),
  })
export type CreateChatInput = z.infer<typeof CreateChatSchema>

export const AddChatMemberSchema = z.object({ userId: z.string().min(1) }).strict()
export type AddChatMemberInput = z.infer<typeof AddChatMemberSchema>

// Изменение названия и описания группы (Ф9+, только админ). Оба поля необязательны, но пустое
// тело отклоняется: запрос, который ничего не меняет, — это ошибка вызывающего, а не «ок».
// Пустая строка в description — способ убрать описание; у title такого смысла нет (чат без
// названия нельзя ни найти, ни назвать), поэтому там min(1).
export const EditChatSchema = z
  .object({
    title: z.string().min(1).max(150).optional(),
    description: z.string().max(CHAT_DESCRIPTION_MAX).optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: vm('validation.chats.nothingToChange'),
  })
export type EditChatInput = z.infer<typeof EditChatSchema>

/**
 * Снимки по дням для календаря перехода по дате (§5 карты интерфейса).
 *
 * `tzOffset` — минуты из `Date.getTimezoneOffset()` браузера: календарь рисует местные даты,
 * и сервер должен разложить снимки по тем же дням, которые видит человек. Диапазон ±14 часов
 * покрывает все существующие пояса вместе с летним временем.
 */
export const ChatMediaCalendarQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
  })
  .strict()
  .refine((v) => new Date(v.from) <= new Date(v.to), {
    path: ['to'],
    message: vm('validation.range.endNotBeforeStart'),
  })
export type ChatMediaCalendarQueryInput = z.infer<typeof ChatMediaCalendarQuerySchema>

/**
 * Выгрузка истории чата файлом (`GET /chats/:id/export/file`): формат и язык шапки. Через
 * схему, а не голым `@Query('locale')`: повторённый параметр приходил массивом и ронял
 * разбор языка в 500.
 */
export const ChatExportFileQuerySchema = z
  .object({
    format: z.enum(['txt', 'json']).default('txt'),
    locale: z.enum(['ru', 'kk', 'en']).optional(),
  })
  .strict()
export type ChatExportFileQueryInput = z.infer<typeof ChatExportFileQuerySchema>

/**
 * Сколько очищенных периодов помнит участник чата. Диапазоны хранятся слитыми, так что
 * пятьдесят — это пятьдесят разрозненных кусков истории; дальше человек не «чистит период»,
 * а хочет очистить чат целиком, и предлагать это честнее, чем молча склеивать его периоды
 * и прятать то, о чём он не просил.
 */
export const CLEARED_RANGES_MAX = 50

/**
 * Очистка истории «для меня». Без полей — всё до текущего момента (прежнее поведение).
 * С `from`/`to` — только этот период (§5 карты интерфейса: режим диапазона в календаре).
 * Границы включительны и задаются целыми днями со стороны клиента.
 */
export const ClearChatSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict()
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: vm('validation.range.bothBounds'),
  })
  .refine((v) => !v.from || !v.to || new Date(v.from) <= new Date(v.to), {
    path: ['to'],
    message: vm('validation.range.endNotBeforeStart'),
  })
export type ClearChatInput = z.infer<typeof ClearChatSchema>

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
    // Message.seq — Int (int32): больше значения в колонке быть не может.
    since: z.coerce.number().int().min(0).max(2_147_483_647),
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
  hasFile: queryBoolean.optional(),
})
export type MessageSearchQueryInput = z.infer<typeof MessageSearchQuerySchema>

// Отключение уведомлений на время (§17): minutes — на сколько заглушить (нет/0 — «навсегда»).
// Потолок — год: дольше это уже «навсегда», а без предела срок вылетал за пределы даты.
// importantOnly — режим «только важные»: чат заглушён, но ответы на мои сообщения и упоминания
// меня по имени уведомление всё равно создают.
export const MUTE_MAX_MINUTES = 365 * 24 * 60
export const MuteSchema = z
  .object({
    minutes: z.coerce.number().int().positive().max(MUTE_MAX_MINUTES).optional(),
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
  /** Исключений — столько же, сколько явных чатов: это тот же список, только «наоборот». */
  MAX_EXCLUDED_PER_FOLDER: 200,
  NAME_MAX: 40,
  /** Цветов вкладки в палитре клиента (индексы 0..6). */
  COLOR_COUNT: 7,
} as const

/**
 * Значок, цвет и правила состава папки (Telegram-стиль) — общие поля создания и правки.
 *
 * `emoji` проверяется той же `isSingleEmoji`, что реакции: на вкладке помещается ровно один
 * значок. Стрелка в refine, а не ссылка на функцию напрямую, — схема строится раньше, чем
 * объявлены константы проверки ниже по файлу. `null` у значка и цвета — «убрать».
 */
const folderRuleFields = {
  emoji: z
    .string()
    .refine((v) => isSingleEmoji(v), vm('validation.chats.folderEmoji'))
    .nullable()
    .optional(),
  color: z
    .number()
    .int()
    .min(0)
    .max(CHAT_FOLDER_LIMITS.COLOR_COUNT - 1)
    .nullable()
    .optional(),
  excludedChatIds: z.array(entityId).max(CHAT_FOLDER_LIMITS.MAX_EXCLUDED_PER_FOLDER).optional(),
  includeContacts: z.boolean().optional(),
  includeNonContacts: z.boolean().optional(),
  includeGroups: z.boolean().optional(),
}

/** Чат не может быть одновременно в папке явно и исключённым из неё — что из двух имелось в виду, неясно. */
function noFolderOverlap(v: { chatIds?: string[]; excludedChatIds?: string[] }): boolean {
  if (!v.chatIds || !v.excludedChatIds) return true
  const excluded = new Set(v.excludedChatIds)
  return !v.chatIds.some((id) => excluded.has(id))
}

export const CreateChatFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(CHAT_FOLDER_LIMITS.NAME_MAX),
    chatIds: z.array(z.string().min(1)).max(CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER).optional(),
    ...folderRuleFields,
  })
  .strict()
  .refine(noFolderOverlap, {
    path: ['excludedChatIds'],
    message: vm('validation.chats.folderChatExcluded'),
  })
export type CreateChatFolderInput = z.infer<typeof CreateChatFolderSchema>

/** Правка папки: переименование и/или полная замена состава (не дельта — так проще на клиенте). */
export const UpdateChatFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(CHAT_FOLDER_LIMITS.NAME_MAX).optional(),
    chatIds: z.array(z.string().min(1)).max(CHAT_FOLDER_LIMITS.MAX_CHATS_PER_FOLDER).optional(),
    position: z.coerce.number().int().min(0).max(CHAT_FOLDER_LIMITS.MAX_FOLDERS).optional(),
    ...folderRuleFields,
  })
  .strict()
  .refine((v) => Object.values(v).some((field) => field !== undefined), {
    message: vm('validation.common.nothingToChange'),
  })
  .refine(noFolderOverlap, {
    path: ['excludedChatIds'],
    message: vm('validation.chats.folderChatExcluded'),
  })
export type UpdateChatFolderInput = z.infer<typeof UpdateChatFolderSchema>

/** Ровно ли один раз встречается каждый id: перестановка с дублем не задаёт порядка. */
function uniqueIds(ids: string[]): boolean {
  return new Set(ids).size === ids.length
}

/**
 * Порядок вкладок-папок (`PUT /chats/folders/order`): ровно все папки пользователя, сверху
 * вниз. Множество сверяет сервер — схема знает только про дубли.
 */
export const ChatFoldersOrderSchema = z
  .object({
    folderIds: z.array(entityId).min(1).max(CHAT_FOLDER_LIMITS.MAX_FOLDERS),
  })
  .strict()
  .refine((v) => uniqueIds(v.folderIds), {
    path: ['folderIds'],
    message: vm('validation.common.duplicateIds'),
  })
export type ChatFoldersOrderInput = z.infer<typeof ChatFoldersOrderSchema>

/** Заглушить все чаты папки (`POST /chats/folders/:id/mute`) — те же поля, что у одного чата. */
export const ChatFolderMuteSchema = MuteSchema
export type ChatFolderMuteInput = z.infer<typeof ChatFolderMuteSchema>

/**
 * Типы чатов, которые правило «все группы» включает в папку. Личные, «Сохранённые» и
 * поддержка сюда не входят: первые делятся на контакты и не контакты, а «Сохранённые» и
 * обращения в поддержку попадают в папку только явно.
 */
export const CHAT_FOLDER_GROUP_TYPES: readonly ChatTypeValue[] = [
  'GROUP',
  'GROUP_OFFICIAL',
  'SUBJECT',
  'FACULTY',
  'DEAN',
  'EVENT',
]

/** Что про папку нужно правилу состава. */
export interface ChatFolderRule {
  chatIds: readonly string[]
  excludedChatIds: readonly string[]
  includeContacts: boolean
  includeNonContacts: boolean
  includeGroups: boolean
}

/** Что про чат нужно правилу состава. `isFriend` значим только у `PRIVATE`. */
export interface ChatFolderCandidate {
  id: string
  type: string
  isFriend: boolean
}

/**
 * Входит ли чат в папку (docs/PROJECT.md §8.3 «Папки»). Одна функция на сервер (заглушение
 * папки) и клиентов (вкладки): папка, собранная правилами на телефоне, должна показывать на
 * вебе те же чаты, а заглушение — касаться ровно того, что человек видит во вкладке.
 *
 * Чат в папке ⇔ НЕ исключён И (в явном списке ИЛИ подходит под включённое правило).
 */
export function chatInFolder(folder: ChatFolderRule, chat: ChatFolderCandidate): boolean {
  if (folder.excludedChatIds.includes(chat.id)) return false
  if (folder.chatIds.includes(chat.id)) return true
  if (chat.type === 'PRIVATE') {
    return chat.isFriend ? folder.includeContacts : folder.includeNonContacts
  }
  return folder.includeGroups && CHAT_FOLDER_GROUP_TYPES.includes(chat.type as ChatTypeValue)
}

/** Сколько чатов можно закрепить порядком за раз (`PUT /chats/pinned/order`). */
export const PINNED_ORDER_MAX = 100

/**
 * Порядок закреплённых чатов сверху вниз. Не перечисленные закреплённые остаются ниже в
 * прежнем порядке — клиенту не нужно знать все закреплённые, чтобы поднять один.
 */
export const PinnedChatsOrderSchema = z
  .object({ chatIds: z.array(entityId).min(1).max(PINNED_ORDER_MAX) })
  .strict()
  .refine((v) => uniqueIds(v.chatIds), {
    path: ['chatIds'],
    message: vm('validation.common.duplicateIds'),
  })
export type PinnedChatsOrderInput = z.infer<typeof PinnedChatsOrderSchema>

/** Сколько чатов читается одним запросом (`POST /chats/read`); «прочитать все» — пачками. */
export const MARK_READ_BATCH_MAX = 200

/** Прочитать чаты целиком (`POST /chats/read`). Чаты, где человек не участник, пропускаются. */
export const MarkChatsReadSchema = z
  .object({ chatIds: z.array(entityId).min(1).max(MARK_READ_BATCH_MAX) })
  .strict()
export type MarkChatsReadInput = z.infer<typeof MarkChatsReadSchema>

// Опрос в чате (§38–39): вопрос + 2..10 вариантов + настройки.
/** Потолок пояснения к опросу в чате. */
export const CHAT_POLL_DESCRIPTION_MAX = 500

export const CreateChatPollSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    // Пояснение под вопросом. Пустая строка — без пояснения.
    description: z.string().trim().max(CHAT_POLL_DESCRIPTION_MAX).optional(),
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
// voice — всё аудио (как раньше, для веба); voice_note — только голосовые (`voice-…`);
// music — аудио кроме голосовых; gif — только image/gif.
export const ChatMediaTypeSchema = z
  .enum(['media', 'file', 'voice', 'voice_note', 'music', 'gif'])
  .default('media')

export const ChatMediaQuerySchema = CursorPaginationSchema.extend({
  type: ChatMediaTypeSchema,
  // Как у истории сообщений: older (по умолчанию) — к более старым от курсора, newer — к
  // более новым (просмотрщик, открытый на файле из середины, листает в обе стороны).
  direction: z.enum(['older', 'newer']).optional(),
})
export type ChatMediaQueryInput = z.infer<typeof ChatMediaQuerySchema>

/** Место файла среди материалов того же типа (`GET /chats/:id/media/:fileId/position`). */
export const ChatMediaPositionQuerySchema = z.object({ type: ChatMediaTypeSchema }).strict()
export type ChatMediaPositionQueryInput = z.infer<typeof ChatMediaPositionQuerySchema>

// Отправка сообщения с вложениями через REST (multipart): текст опционален, если есть файлы.
export const MessageSendRestSchema = z
  .object({
    chatId: z.string().min(1),
    content: optionalMessageText(),
    replyToId: z.string().min(1).optional(),
    // Ответ с цитатой фрагмента: выделенный кусок исходного сообщения. Хранится копией —
    // оригинал могут отредактировать, и смещения в тексте поехали бы. Без replyToId
    // бессмыслен: цитировать нечего.
    replyQuote: z.string().min(1).max(500).optional(),
    // §34: пометить все вложения сообщения спойлером (размытие до клика).
    spoiler: queryBoolean.optional(),
    // §34: спойлер не на всё сообщение, а поимённо — номера вложений в порядке их отправки
    // («0,3,4»). В альбоме из десяти снимков скрыть могут один, и общий флаг этого не выражает.
    // `spoiler: true` остаётся коротким «скрыть всё» и старые клиенты не ломает.
    spoilerIndexes: z
      .string()
      .regex(/^\d+(,\d+)*$/, vm('validation.chats.spoilerIndexes'))
      .optional(),
    // §9: отправить вложения «без сжатия» — получатель видит строки файлов, а не превью,
    // даже если это картинки. Флаг всего сообщения: в одном сообщении вложения уходят
    // одним способом, как и выбирают его в диалоге отправки — один раз на всю отправку.
    asFiles: queryBoolean.optional(),
    // multipart отдаёт поля строками, поэтому queryBoolean (в отличие от WS-схемы ниже):
    // `z.coerce.boolean()` читал строку "false" как true.
    silent: queryBoolean.optional(),
    // Ключ повтора отправки: тот же nonce в течение 10 минут не создаёт второе сообщение.
    nonce: z.string().min(1).max(CHAT_NONCE_MAX).optional(),
  })
  .strict()
  // Цитата без ответа не имеет смысла — из чего цитата, непонятно ни серверу, ни клиенту.
  .refine((v) => !v.replyQuote || !!v.replyToId, {
    path: ['replyQuote'],
    message: vm('validation.chats.quoteWithoutReply'),
  })
export type MessageSendRestInput = z.infer<typeof MessageSendRestSchema>

// Отложенное сообщение: только текст (вложения у отложенных не поддерживаются — файл
// пришлось бы держать в бакете без владельца-сообщения, и ночная чистка сирот удалила бы
// его до отправки). Время — строго в будущем и не дальше года.
export const ScheduleMessageSchema = z
  .object({
    content: messageText(),
    replyToId: z.string().min(1).optional(),
    replyQuote: z.string().min(1).max(500).optional(),
    silent: z.boolean().optional(),
    scheduledAt: z.string().datetime(),
  })
  .strict()
  .refine((v) => new Date(v.scheduledAt).getTime() > Date.now(), {
    path: ['scheduledAt'],
    message: vm('validation.chats.scheduleInPast'),
  })
  .refine((v) => new Date(v.scheduledAt).getTime() < Date.now() + 365 * 24 * 60 * 60 * 1000, {
    path: ['scheduledAt'],
    message: vm('validation.chats.scheduleTooFar'),
  })
export type ScheduleMessageInput = z.infer<typeof ScheduleMessageSchema>

// Правка отложенного до отправки: текст и/или новое время.
export const UpdateScheduledMessageSchema = z
  .object({
    content: messageText().optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((v) => v.content !== undefined || v.scheduledAt !== undefined, {
    message: vm('validation.common.nothingToChange'),
  })
  .refine((v) => !v.scheduledAt || new Date(v.scheduledAt).getTime() > Date.now(), {
    path: ['scheduledAt'],
    message: vm('validation.chats.scheduleInPast'),
  })
export type UpdateScheduledMessageInput = z.infer<typeof UpdateScheduledMessageSchema>

/** Потолок длины эмодзи-реакции в UTF-16: хватает на самые длинные ZWJ-семьи и флаги-теги. */
export const REACTION_EMOJI_MAX = 32

// Один элемент эмодзи: пиктограмма с необязательным селектором U+FE0F и модификатором тона кожи.
const EMOJI_ATOM = '(?:\\p{Extended_Pictographic}\\uFE0F?\\p{Emoji_Modifier}?)'
const SINGLE_EMOJI_RE = new RegExp(
  '^(?:' +
    // Флаг страны — пара региональных индикаторов.
    '\\p{Regional_Indicator}{2}' +
    // Клавиша: цифра, # или * + U+20E3.
    '|[#*0-9]\\uFE0F?\\u20E3' +
    // Флаг-тег (Англия, Шотландия): 🏴 + теги + завершающий тег.
    '|\\u{1F3F4}[\\u{E0020}-\\u{E007E}]+\\u{E007F}' +
    // Пиктограмма и цепочка через ZWJ (семьи, профессии, радужный флаг).
    `|${EMOJI_ATOM}(?:\\u200D${EMOJI_ATOM})*` +
    ')$',
  'u',
)

/**
 * Ровно один эмодзи (одна графема): одиночная пиктограмма, с тоном кожи, ZWJ-последовательность,
 * флаг или клавиша. Текст, два эмодзи подряд и буквы не проходят — под сообщением снова
 * появились бы слова, ради чего раньше и стоял белый список.
 */
export function isSingleEmoji(value: string): boolean {
  return value.length > 0 && value.length <= REACTION_EMOJI_MAX && SINGLE_EMOJI_RE.test(value)
}

// Реакция-эмодзи на сообщение (Ф9+): тоггл по [сообщение, пользователь, эмодзи]. Любой один
// эмодзи — набор быстрых реакций (CHAT_REACTION_EMOJIS) остался только подсказкой клиентам.
export const MessageReactionSchema = z
  .object({
    emoji: z
      .string()
      .min(1)
      .max(REACTION_EMOJI_MAX)
      .refine(isSingleEmoji, vm('validation.chats.reactionEmoji')),
  })
  .strict()
export type MessageReactionInput = z.infer<typeof MessageReactionSchema>

// Пересылка сообщения в текущий чат (:id — цель): messageId — источник (из любого моего чата).
export const MessageForwardSchema = z.object({ messageId: z.string().min(1) }).strict()
export type MessageForwardInput = z.infer<typeof MessageForwardSchema>

/** Потолки пересылки пачкой: сообщений за раз и чатов-получателей. */
export const FORWARD_BATCH_LIMITS = { MESSAGES: 100, CHATS: 20 } as const

/**
 * Пересылка пачкой (`POST /chats/forward`): несколько сообщений в несколько чатов, с
 * необязательным комментарием — он уходит в каждый чат обычным сообщением перед пересланными.
 * requestId — ключ идемпотентности: повтор с тем же ключом сутки отдаёт прежний ответ.
 */
export const MessageForwardBatchSchema = z
  .object({
    messageIds: z.array(entityId).min(1).max(FORWARD_BATCH_LIMITS.MESSAGES),
    chatIds: z.array(entityId).min(1).max(FORWARD_BATCH_LIMITS.CHATS),
    comment: messageText().optional(),
    requestId: z.string().uuid(),
  })
  .strict()
export type MessageForwardBatchInput = z.infer<typeof MessageForwardBatchSchema>

/** Сколько сообщений за раз можно скрыть у себя или удалить у всех. */
export const MESSAGE_BULK_MAX = 100

/** «Удалить у себя» (`POST /chats/:id/messages/hide`) и «удалить у всех» пачкой (`…/delete`). */
export const MessageIdsSchema = z
  .object({ messageIds: z.array(entityId).min(1).max(MESSAGE_BULK_MAX) })
  .strict()
export type MessageIdsInput = z.infer<typeof MessageIdsSchema>

/** Общие поля отправки особых сообщений (геопозиция, контакт, чек-лист, стикер, GIF). */
const richMessageFields = {
  replyToId: entityId.optional(),
  nonce: z.string().min(1).max(CHAT_NONCE_MAX).optional(),
}

/** Сроки трансляции геопозиции в секундах: 15 минут, час, 8 часов (как в Telegram). */
export const LIVE_LOCATION_PERIODS = [900, 3600, 28800] as const
export type LiveLocationPeriod = (typeof LIVE_LOCATION_PERIODS)[number]

/** Точность (м) и направление движения (градусы от севера) точки геопозиции. */
const locationFix = {
  accuracy: z.number().min(0).max(100_000).optional(),
  heading: z.number().min(0).max(360).optional(),
}

/**
 * Геопозиция (`POST /chats/:id/location`). С `livePeriod` — трансляция: точку двигает
 * `POST /chats/messages/:messageId/live-location` до `liveUntil = now + livePeriod`.
 */
export const ChatLocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    title: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    livePeriod: z
      .number()
      .int()
      .refine(
        (v) => (LIVE_LOCATION_PERIODS as readonly number[]).includes(v),
        vm('validation.chats.livePeriod'),
      )
      .optional(),
    ...locationFix,
    ...richMessageFields,
  })
  .strict()
export type ChatLocationInput = z.infer<typeof ChatLocationSchema>

/** Новая точка трансляции (`POST /chats/messages/:messageId/live-location`). */
export const LiveLocationUpdateSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    ...locationFix,
  })
  .strict()
export type LiveLocationUpdateInput = z.infer<typeof LiveLocationUpdateSchema>

/** Потолки карточки контакта. */
export const CHAT_CONTACT_LIMITS = { NAME_MAX: 200, ITEMS_MAX: 5, PHONE_MAX: 40 } as const

/** Карточка контакта (`POST /chats/:id/contact`): хотя бы один телефон или адрес. */
export const ChatContactSchema = z
  .object({
    name: z.string().trim().min(1).max(CHAT_CONTACT_LIMITS.NAME_MAX),
    phones: z
      .array(z.string().trim().min(1).max(CHAT_CONTACT_LIMITS.PHONE_MAX))
      .max(CHAT_CONTACT_LIMITS.ITEMS_MAX)
      .optional(),
    emails: z
      .array(z.string().trim().email().max(254))
      .max(CHAT_CONTACT_LIMITS.ITEMS_MAX)
      .optional(),
    ...richMessageFields,
  })
  .strict()
  .refine((v) => (v.phones?.length ?? 0) + (v.emails?.length ?? 0) > 0, {
    path: ['phones'],
    message: vm('validation.chats.contactEmpty'),
  })
export type ChatContactInput = z.infer<typeof ChatContactSchema>

/** Потолки чек-листа: пунктов в списке и длина строк. */
export const CHAT_CHECKLIST_LIMITS = { ITEMS_MAX: 50, TITLE_MAX: 200, ITEM_MAX: 200 } as const

/** Чек-лист (`POST /chats/:id/checklist`). */
export const ChatChecklistCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(CHAT_CHECKLIST_LIMITS.TITLE_MAX),
    items: z
      .array(z.string().trim().min(1).max(CHAT_CHECKLIST_LIMITS.ITEM_MAX))
      .min(1)
      .max(CHAT_CHECKLIST_LIMITS.ITEMS_MAX),
    othersCanAdd: z.boolean().optional(),
    othersCanMark: z.boolean().optional(),
    ...richMessageFields,
  })
  .strict()
export type ChatChecklistCreateInput = z.infer<typeof ChatChecklistCreateSchema>

/** Новый пункт чек-листа (`POST /chats/checklists/:checklistId/items`). */
export const ChatChecklistItemAddSchema = z
  .object({ text: z.string().trim().min(1).max(CHAT_CHECKLIST_LIMITS.ITEM_MAX) })
  .strict()
export type ChatChecklistItemAddInput = z.infer<typeof ChatChecklistItemAddSchema>

/** Отметить пункт (`POST /chats/checklists/:checklistId/items/:itemId/toggle`). */
export const ChatChecklistItemToggleSchema = z.object({ done: z.boolean() }).strict()
export type ChatChecklistItemToggleInput = z.infer<typeof ChatChecklistItemToggleSchema>

/** Стикер из каталога (`POST /chats/:id/sticker`). */
export const ChatStickerSendSchema = z
  .object({ stickerId: entityId, ...richMessageFields })
  .strict()
export type ChatStickerSendInput = z.infer<typeof ChatStickerSendSchema>

/** Повторная отправка GIF (`POST /chats/:id/gif`) — файла из чата, где отправитель участник. */
export const ChatGifSendSchema = z.object({ fileId: entityId, ...richMessageFields }).strict()
export type ChatGifSendInput = z.infer<typeof ChatGifSendSchema>

/** Недавние GIF (`GET /chats/gifs/recent`). */
export const ChatGifRecentQuerySchema = z
  .object({ limit: z.coerce.number().int().positive().max(50).default(30) })
  .strict()
export type ChatGifRecentQueryInput = z.infer<typeof ChatGifRecentQuerySchema>

/** Поиск GIF во внешнем каталоге: потолок выдачи за раз и длина запроса. */
export const GIF_SEARCH_LIMITS = { LIMIT_MAX: 50, LIMIT_DEFAULT: 24, QUERY_MAX: 50 } as const

const gifPage = {
  offset: z.coerce.number().int().min(0).max(4999).default(0),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(GIF_SEARCH_LIMITS.LIMIT_MAX)
    .default(GIF_SEARCH_LIMITS.LIMIT_DEFAULT),
}

/** Популярные GIF каталога (`GET /chats/gifs/trending`). */
export const ChatGifTrendingQuerySchema = z.object(gifPage).strict()
export type ChatGifTrendingQueryInput = z.infer<typeof ChatGifTrendingQuerySchema>

/** Поиск GIF в каталоге (`GET /chats/gifs/search`). */
export const ChatGifSearchQuerySchema = z
  .object({ q: z.string().trim().min(1).max(GIF_SEARCH_LIMITS.QUERY_MAX), ...gifPage })
  .strict()
export type ChatGifSearchQueryInput = z.infer<typeof ChatGifSearchQuerySchema>

/** Внешние каталоги GIF. Сейчас один — GIPHY. */
export const CHAT_GIF_PROVIDERS = ['giphy'] as const

/**
 * GIF из внешнего каталога (`POST /chats/:id/gif/external`). Клиент передаёт только id —
 * адрес картинки сервер берёт у каталога сам (ссылке клиента не верим: SSRF).
 */
export const ChatGifExternalSendSchema = z
  .object({
    provider: z.enum(CHAT_GIF_PROVIDERS),
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9]+$/),
    ...richMessageFields,
  })
  .strict()
export type ChatGifExternalSendInput = z.infer<typeof ChatGifExternalSendSchema>

/** Опросы чата (`GET /chats/:id/polls`) — свежие первыми. */
export const ChatPollsQuerySchema = CursorPaginationSchema
export type ChatPollsQueryInput = z.infer<typeof ChatPollsQuerySchema>

/** Каталог стикеров: картинка не больше 512 КБ, только png/webp/gif. */
export const STICKER_LIMITS = {
  MAX_BYTES: 512 * 1024,
  MIMES: ['image/png', 'image/webp', 'image/gif'],
  TITLE_MAX: 64,
  SETS_MAX: 100,
  STICKERS_PER_SET_MAX: 200,
} as const

/** Сколько стикеров помнит «Избранное»: сверх — вытесняется самый давний. */
export const FAVORITE_STICKERS_MAX = 30

/** Набор стикеров (`POST /admin/sticker-sets`). slug — латиница, цифры, `-` и `_`. */
export const StickerSetCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(STICKER_LIMITS.TITLE_MAX),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, vm('validation.chats.stickerSlug')),
  })
  .strict()
export type StickerSetCreateInput = z.infer<typeof StickerSetCreateSchema>

export const StickerSetUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(STICKER_LIMITS.TITLE_MAX).optional(),
    order: z.number().int().min(0).max(100_000).optional(),
    isPublished: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.order !== undefined || v.isPublished !== undefined, {
    message: vm('validation.common.nothingToChange'),
  })
export type StickerSetUpdateInput = z.infer<typeof StickerSetUpdateSchema>

/** Поля multipart загрузки стикера (`POST /admin/sticker-sets/:id/stickers`) кроме файла. */
export const StickerUploadFieldsSchema = z
  .object({
    emoji: z
      .string()
      .max(REACTION_EMOJI_MAX)
      .refine(isSingleEmoji, vm('validation.chats.reactionEmoji'))
      .optional(),
  })
  .strict()
export type StickerUploadFieldsInput = z.infer<typeof StickerUploadFieldsSchema>

// Поделиться постом в чат (:id — цель): postId — пост (должен быть виден отправителю),
// comment — необязательная подпись. В сообщении сохраняется sharedPostId → превью-карточка.
export const SharePostSchema = z
  .object({ postId: z.string().min(1), comment: z.string().max(4000).optional() })
  .strict()
export type SharePostInput = z.infer<typeof SharePostSchema>

// Переслать сторис в личный чат (:id — цель). Сторис должна быть видна и отправителю, и
// получателю: пересылка не открывает её вне аудитории. В сообщении — sharedStoryId.
export const ShareStorySchema = z
  .object({ storyId: z.string().min(1), comment: z.string().max(4000).optional() })
  .strict()
export type ShareStoryInput = z.infer<typeof ShareStorySchema>

// Ответ на сторис: личное сообщение автору с карточкой сторис. Чат с автором находится
// или создаётся по обычным правилам переписки (блокировки, запросы, вуз).
export const StoryReplySchema = z
  .object({ storyId: z.string().min(1), content: z.string().trim().min(1).max(1000) })
  .strict()
export type StoryReplyInput = z.infer<typeof StoryReplySchema>

// ── WebSocket payloads (валидируются той же схемой, что и REST — WS не доверенный, §10) ──

export const ChatJoinSchema = z.object({ chatId: z.string().min(1) }).strict()
export type ChatJoinInput = z.infer<typeof ChatJoinSchema>

// Вступление в группу по ссылке-приглашению: код из ссылки, а не только id чата.
export const JoinChatByInviteSchema = z.object({ code: z.string().min(8).max(64) }).strict()
export type JoinChatByInviteInput = z.infer<typeof JoinChatByInviteSchema>

export const MessageSendSchema = z
  .object({
    chatId: z.string().min(1),
    content: messageText(),
    replyToId: z.string().min(1).optional(),
    // Ответ с цитатой фрагмента: выделенный кусок исходного сообщения. Хранится копией —
    // оригинал могут отредактировать, и смещения в тексте поехали бы. Без replyToId
    // бессмыслен: цитировать нечего.
    replyQuote: z.string().min(1).max(500).optional(),
    // Отправить «без звука»: сообщение доставляется, уведомление и push по нему — нет.
    silent: z.boolean().optional(),
    // Клиентский идентификатор для оптимистичной отправки (#1): сервер эхом возвращает его в
    // message:new, чтобы отправитель заменил свой временный «pending» пузырь. В БД не пишется.
    nonce: z.string().min(1).max(CHAT_NONCE_MAX).optional(),
  })
  .strict()
  // Цитата без ответа не имеет смысла — из чего цитата, непонятно ни серверу, ни клиенту.
  .refine((v) => !v.replyQuote || !!v.replyToId, {
    path: ['replyQuote'],
    message: vm('validation.chats.quoteWithoutReply'),
  })
export type MessageSendInput = z.infer<typeof MessageSendSchema>

export const MessageEditSchema = z
  .object({ messageId: z.string().min(1), content: messageText() })
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

/**
 * Что человек делает в чате прямо сейчас (§9.1). Показывается остальным участникам короткой
 * подписью вместо статуса — «печатает…», «записывает голосовое…».
 *
 * Это НЕ тип сообщения. Тип сообщения в проекте вообще не хранится: вид вложения выводится
 * при рендере из mime, имени файла (`voice-…`) и флага asDocument. Действие живёт секунды,
 * никуда не сохраняется и существует только пока идёт.
 *
 * Список намеренно короткий — ровно то, что в продукте есть и что заметно длится:
 *
 * - `TYPING` — набор текста;
 * - `RECORDING_VOICE` — запись голосового (самый длинный «немой» промежуток: 10–60 секунд);
 * - `UPLOADING_PHOTO` / `UPLOADING_VIDEO` / `UPLOADING_FILE` — отправка вложения.
 *
 * Аудиофайла отдельным действием нет: mp3 уходит обычным вложением через скрепку, и для
 * получателя это «отправляет файл…». Стикеров, GIF, геолокации и контактов в продукте нет —
 * действий под них не заводим.
 */
export const CHAT_ACTIONS = [
  'TYPING',
  'RECORDING_VOICE',
  'UPLOADING_PHOTO',
  'UPLOADING_VIDEO',
  'UPLOADING_FILE',
] as const
export type ChatAction = (typeof CHAT_ACTIONS)[number]
export const ChatActionSchema = z.enum(CHAT_ACTIONS)

/**
 * Payload события `chat:action`. `action: null` — «действие закончилось».
 *
 * Полей `startedAt`/`expiresAt`/`messageId` здесь нет намеренно. Время жизни подписи держит
 * получатель (сбрасывает через несколько секунд без обновления), поэтому серверные часы не
 * нужны, а сообщения в момент действия ещё не существует.
 */
export const ChatActionPayloadSchema = z
  .object({ chatId: z.string().min(1), action: ChatActionSchema.nullable() })
  .strict()
export type ChatActionPayloadInput = z.infer<typeof ChatActionPayloadSchema>

export const AuthRefreshSchema = z.object({ token: z.string().min(1) }).strict()
export type AuthRefreshInput = z.infer<typeof AuthRefreshSchema>

// ── Крупные вложения чата: прямая загрузка в хранилище (Фаза 19.0) ───────────
// Файлы больше FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES через multipart-запрос не проходят:
// тело целиком ложится в память процесса. Такие уходят в хранилище напрямую, а сообщение
// создаётся уже по ключам загруженных объектов.
//
// Пара presign/multipart своя, а не общая из /files, по тому же принципу, что у документов и
// материалов: бакет определяет модуль, а членство в чате проверяется на каждом шаге.

/** Подписанная ссылка на одиночный PUT вложения чата. */
export const ChatAttachmentPresignSchema = z.object({ mime: z.string().min(1).max(120) }).strict()
export type ChatAttachmentPresignInput = z.infer<typeof ChatAttachmentPresignSchema>

/** Открыть многочастную загрузку вложения чата. */
export const ChatAttachmentMultipartStartSchema = z
  .object({ mime: z.string().min(1).max(120), size: z.number().int().positive() })
  .strict()
export type ChatAttachmentMultipartStartInput = z.infer<typeof ChatAttachmentMultipartStartSchema>

/** Подписи на диапазон частей вложения чата. */
export const ChatAttachmentMultipartUrlsSchema = z
  .object({
    key: z.string().min(1).max(300),
    uploadId: z.string().min(1).max(300),
    from: z.number().int().min(1),
    to: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    path: ['to'],
    message: vm('validation.upload.partRangeReversed'),
  })
export type ChatAttachmentMultipartUrlsInput = z.infer<typeof ChatAttachmentMultipartUrlsSchema>

/** Отменить многочастную загрузку вложения: хранилище удаляет залитые части. */
export const ChatAttachmentMultipartAbortSchema = z
  .object({
    key: z.string().min(1).max(300),
    uploadId: z.string().min(1).max(300),
  })
  .strict()
export type ChatAttachmentMultipartAbortInput = z.infer<typeof ChatAttachmentMultipartAbortSchema>

/**
 * Отправка сообщения по уже загруженным объектам.
 *
 * Спойлер здесь у каждого вложения свой, а не номерами, как в multipart-варианте: там номер —
 * единственный способ сослаться на файл внутри одного тела запроса, а тут вложения и так
 * перечислены поштучно.
 *
 * `parts` заполнены — объект собирается из частей; пусто — он уже лежит целиком (одиночный PUT).
 */
export const MessageSendUploadedSchema = z
  .object({
    content: optionalMessageText(),
    replyToId: z.string().min(1).optional(),
    replyQuote: z.string().min(1).max(500).optional(),
    silent: z.boolean().optional(),
    // §9: показывать вложения строками файлов, а не превью.
    asFiles: z.boolean().optional(),
    nonce: z.string().min(1).max(CHAT_NONCE_MAX).optional(),
    attachments: z
      .array(
        z
          .object({
            key: z.string().min(1).max(300),
            uploadId: z.string().min(1).max(300).optional(),
            name: z.string().min(1).max(255).optional(),
            spoiler: z.boolean().optional(),
            parts: z
              .array(
                z
                  .object({ part: z.number().int().min(1), etag: z.string().min(1).max(200) })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine((v) => !v.replyQuote || !!v.replyToId, {
    path: ['replyQuote'],
    message: vm('validation.chats.quoteWithoutReply'),
  })
export type MessageSendUploadedInput = z.infer<typeof MessageSendUploadedSchema>
