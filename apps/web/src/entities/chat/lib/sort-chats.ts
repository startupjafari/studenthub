import type { ChatListItem } from '../model/types'

/**
 * Порядок списка чатов: закреплённые сверху (свежее закрепление выше), остальные — по
 * времени последней активности.
 *
 * Сортировка живёт на клиенте, потому что `GET /chats` страничный: внутри одной страницы
 * поднять закреплённые нельзя — чат, закреплённый год назад, лежит на третьей странице по
 * `updatedAt`, и сервер увидел бы его слишком поздно. Клиент собирает все страницы и
 * сортирует один раз поверх целого.
 */
export function sortChats(chats: ChatListItem[]): ChatListItem[] {
  const time = (v: string | null): number => (v ? new Date(v).getTime() : 0)
  return [...chats].sort((a, b) => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1
    if (a.pinnedAt && b.pinnedAt) return time(b.pinnedAt) - time(a.pinnedAt)
    return time(b.updatedAt) - time(a.updatedAt)
  })
}
