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

export const SupportQueueQuerySchema = z.object({
  /** По умолчанию открытые: очередь — это то, что ждёт ответа. */
  status: z.enum(['open', 'closed']).default('open'),
  /** `mine` — только взятые собой; `free` — ещё никем не взятые. */
  assignee: z.enum(['any', 'mine', 'free']).default('any'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
})
export type SupportQueueQueryInput = z.infer<typeof SupportQueueQuerySchema>
