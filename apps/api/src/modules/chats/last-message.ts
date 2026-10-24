import { Prisma } from '@prisma/client'

/** Хватает сырого запроса: подходит и сервис Prisma, и транзакция. */
type RawQueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>

interface LastMessageOptions {
  /**
   * По какому полю «последнее». По умолчанию `seq` — номер сообщения в чате, по нему строится
   * лента. `createdAt` — там, где «последнее» исторически считалось по времени (список чатов:
   * от того же времени считается и непрочитанное).
   */
  by?: 'seq' | 'createdAt'
  /** Учитывать удалённые сообщения. По умолчанию нет: удалённое не превью. */
  includeDeleted?: boolean
}

/**
 * id последнего сообщения в каждом из чатов — не больше одной строки на чат (F-F02).
 *
 * Вложенный `messages: { orderBy, take: 1 }` внутри `chat.findMany` для этого не годится:
 * Prisma без relationJoins применяет `take` к нескольким родителям в памяти — в базу уходит
 * `SELECT … FROM messages WHERE chat_id IN (…)` без LIMIT, и ради одного превью на чат
 * читается вся история чатов страницы вместе с отношениями. LATERAL … LIMIT 1 идёт по
 * индексу чата с конца и останавливается на первой подходящей строке.
 */
export async function lastMessageIds(
  prisma: RawQueryClient,
  chatIds: readonly string[],
  opts: LastMessageOptions = {},
): Promise<Map<string, string>> {
  if (chatIds.length === 0) return new Map()
  const notDeleted = opts.includeDeleted ? Prisma.empty : Prisma.sql`AND m.deleted_at IS NULL`
  const order =
    opts.by === 'createdAt' ? Prisma.sql`m.created_at DESC, m.seq DESC` : Prisma.sql`m.seq DESC`
  const rows = await prisma.$queryRaw<{ chatId: string; id: string }[]>`
    SELECT c.id AS "chatId", lm.id
    FROM chats c
    CROSS JOIN LATERAL (
      SELECT m.id
      FROM messages m
      WHERE m.chat_id = c.id ${notDeleted}
      ORDER BY ${order}
      LIMIT 1
    ) lm
    WHERE c.id IN (${Prisma.join([...chatIds])})`
  return new Map(rows.map((row) => [row.chatId, row.id]))
}

/**
 * Последние сообщения чатов в нужной вызывающему форме: id — одним запросом
 * (`lastMessageIds`), сами строки — вторым, по первичному ключу. Чат без сообщений в
 * результат не попадает.
 */
export async function lastMessagesOf<T extends { chatId: string }>(
  prisma: RawQueryClient,
  chatIds: readonly string[],
  load: (messageIds: string[]) => Promise<T[]>,
  opts: LastMessageOptions = {},
): Promise<Map<string, T>> {
  const ids = await lastMessageIds(prisma, chatIds, opts)
  if (ids.size === 0) return new Map()
  const rows = await load([...ids.values()])
  return new Map(rows.map((row) => [row.chatId, row]))
}
