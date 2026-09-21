import { z } from 'zod'

// Обращение в поддержку платформы: приватная переписка человека с командой платформы.
//
// Технически это чат типа SUPPORT_PLATFORM — домен чатов уже умеет вложения, WS, прочтения
// и голосовые, и заводить ради переписки второй механизм сообщений было бы дороже во всём.
// Отличие от чата вуза `SUPPORT` принципиальное: там общая комната, где состоят все, здесь
// участники — автор и команда платформы.

/** Первое сообщение. Нижняя граница не придирка: «Помогите» не даёт поддержке ничего. */
export const OpenSupportTicketSchema = z.object({
  text: z.string().trim().min(10, 'Опишите вопрос подробнее').max(4000),
})
export type OpenSupportTicketInput = z.infer<typeof OpenSupportTicketSchema>

export const SupportReplySchema = z.object({
  text: z.string().trim().min(1).max(4000),
})
export type SupportReplyInput = z.infer<typeof SupportReplySchema>

/**
 * О чём обращение. Закрытый список, а не свободные теги: свободные разрастаются в
 * «оценки», «оценка», «Оценки!» за неделю, и сводка «о чём спрашивают чаще» перестаёт
 * складываться. Семь значений покрывают то, с чем в поддержку приходят на деле.
 */
export const SUPPORT_TAGS = [
  /** Не могу войти, пароль, двухфакторка, доступ пропал. */
  'ACCESS',
  /** Неверные данные: расписание, оценки, группа, факультет. */
  'DATA',
  /** Справки, заявки, документы. */
  'DOCS',
  /** Сломалось: ошибка, пустой экран, не грузится. */
  'BUG',
  /** Просьба доработать. */
  'FEATURE',
  /** Жалоба на человека или содержимое — кандидат на перевод в модерацию. */
  'ABUSE',
  'OTHER',
] as const
export const SupportTagSchema = z.enum(SUPPORT_TAGS)
export type SupportTag = z.infer<typeof SupportTagSchema>

/**
 * Теги обращения целиком: сервер хранит ровно то, что прислали. Не больше трёх — набор,
 * означающий всё, не означает ничего, и сводка по нему складывается в шум.
 */
export const SetSupportTagsSchema = z
  .object({
    tags: z.array(SupportTagSchema).max(3),
  })
  .strict()
export type SetSupportTagsInput = z.infer<typeof SetSupportTagsSchema>

export const SupportQueueQuerySchema = z.object({
  /** По умолчанию открытые: очередь — это то, что ждёт ответа. */
  status: z.enum(['open', 'closed']).default('open'),
  /** `mine` — только взятые собой; `free` — ещё никем не взятые. */
  assignee: z.enum(['any', 'mine', 'free']).default('any'),
  /** Поиск по тексту переписки и по фамилии автора. */
  search: z.string().trim().min(2).max(100).optional(),
  /** Только обращения с этим тегом. Фильтрует сервер: клиент видит одну страницу. */
  tag: SupportTagSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})
export type SupportQueueQueryInput = z.infer<typeof SupportQueueQuerySchema>
