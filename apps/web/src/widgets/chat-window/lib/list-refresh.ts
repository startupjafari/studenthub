import { sortChats, type ChatListItem, type ChatMessage } from '../../../entities/chat'

// Точечное обновление списка чатов по событиям (F-F02). Раньше любое событие в любом чате
// перекачивало список целиком — до пятнадцати страниц, — у каждого участника. Здесь — то,
// что можно поправить в строке из самого события, и слияние свежей первой страницы с кэшем.

const time = (iso: string): number => new Date(iso).getTime()

/** Строка `row` у сервера идёт ниже `edge` (порядок страниц: updatedAt ↓, затем id ↓). */
function isBelow(row: ChatListItem, edge: ChatListItem): boolean {
  const a = time(row.updatedAt)
  const b = time(edge.updatedAt)
  return a < b || (a === b && row.id < edge.id)
}

/**
 * Свежая первая страница поверх закэшированного списка.
 *
 * Строки страницы заменяют свои копии в кэше; строки ниже её края берутся из кэша как есть.
 * Чат, который по своему времени лежал бы внутри страницы, но в ней не пришёл, у сервера
 * больше не виден (скрыт, удалён, исключили) — его убираем. `null` — слить нельзя (пустая
 * неполная страница), нужен полный перезапрос.
 */
export function mergeChatHead(
  cached: readonly ChatListItem[],
  head: readonly ChatListItem[],
  complete: boolean,
): ChatListItem[] | null {
  if (complete) return sortChats([...head])
  const edge = head.at(-1)
  if (!edge) return null
  const ids = new Set(head.map((c) => c.id))
  const rest = cached.filter((c) => !ids.has(c.id) && isBelow(c, edge))
  return sortChats([...head, ...rest])
}

/** Заменить строку чата `chatId`, если `patch` её меняет; иначе вернуть тот же массив. */
function patchRow(
  list: ChatListItem[],
  chatId: string,
  patch: (row: ChatListItem) => ChatListItem,
): ChatListItem[] {
  const idx = list.findIndex((c) => c.id === chatId)
  if (idx === -1) return list
  const row = list[idx]!
  const next = patch(row)
  if (next === row) return list
  const copy = list.slice()
  copy[idx] = next
  return copy
}

/**
 * Новое сообщение открытого чата — сразу в превью и порядок строки. Счётчик не трогаем:
 * он серверный (что прочитано, решает отметка), его принесёт склеенный перезапрос.
 */
export function withNewMessage(list: ChatListItem[], message: ChatMessage): ChatListItem[] {
  const next = patchRow(list, message.chatId, (row) => {
    const last = row.lastMessage
    if (last && last.id !== message.id && time(last.createdAt) > time(message.createdAt)) {
      return row
    }
    const updatedAt =
      time(row.updatedAt) >= time(message.createdAt) ? row.updatedAt : message.createdAt
    return { ...row, lastMessage: message, updatedAt }
  })
  return next === list ? list : sortChats(next)
}

/** Правка (или подтянувшееся превью ссылки) последнего сообщения — в превью строки. */
export function withEditedMessage(list: ChatListItem[], message: ChatMessage): ChatListItem[] {
  return patchRow(list, message.chatId, (row) =>
    row.lastMessage?.id === message.id ? { ...row, lastMessage: message } : row,
  )
}

/** Прочтение собеседниками — галочки в превью своих сообщений. */
export function withOthersRead(
  list: ChatListItem[],
  chatId: string,
  readAt: string,
): ChatListItem[] {
  return patchRow(list, chatId, (row) =>
    row.othersReadAt && time(row.othersReadAt) >= time(readAt)
      ? row
      : { ...row, othersReadAt: readAt },
  )
}

/**
 * Своё прочтение (здесь или на другом устройстве). Дочитано до последнего сообщения — счётчик
 * гасим на месте. Возвращает `null`, если по событию этого не решить (дочитано не до конца,
 * строки нет в кэше) — тогда нужен перезапрос.
 */
export function withOwnRead(
  list: ChatListItem[],
  chatId: string,
  readAt: string,
): ChatListItem[] | null {
  const row = list.find((c) => c.id === chatId)
  if (!row) return null
  const last = row.lastMessage
  if (last && time(last.createdAt) > time(readAt)) return null
  if (row.unreadCount === 0 && !row.unread) return list
  return patchRow(list, chatId, (r) => ({ ...r, unreadCount: 0, unread: false }))
}
