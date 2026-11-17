import type { ChatListItem } from '../model/types'

/**
 * Время активности строки: последнее событие чата или сохранённый черновик, что свежее. Чат,
 * где человек начал писать, встаёт по времени черновика — как в Telegram.
 */
export function chatActivityTime(chat: ChatListItem): number {
  const time = (v: string | null | undefined): number => (v ? new Date(v).getTime() : 0)
  const updated = time(chat.updatedAt)
  return chat.draft ? Math.max(updated, time(chat.draftAt)) : updated
}

/**
 * Порядок списка чатов: закреплённые сверху, остальные — по времени последней активности
 * (с учётом черновика, см. chatActivityTime).
 *
 * Среди закреплённых первым идёт порядок, заданный руками (`pinnedOrder`, 0 — верх); у кого
 * его нет — ниже упорядоченных, свежее закрепление выше. Так же раскладывает и сервер.
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
    if (a.pinnedAt && b.pinnedAt) {
      const ao = a.pinnedOrder ?? null
      const bo = b.pinnedOrder ?? null
      if (ao !== null && bo !== null && ao !== bo) return ao - bo
      if ((ao === null) !== (bo === null)) return ao !== null ? -1 : 1
      return time(b.pinnedAt) - time(a.pinnedAt)
    }
    return chatActivityTime(b) - chatActivityTime(a)
  })
}
