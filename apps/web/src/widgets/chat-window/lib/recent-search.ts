// «Недавние» глобального поиска чатов (Telegram-стиль): чаты, которые человек открывал из
// выдачи поиска, — первыми, когда он снова открывает поиск.
//
// Хранится только список id и только в этом браузере: это удобство одного человека на одном
// устройстве, а не данные, которые должны пережить смену устройства. Ключ — с id владельца:
// на общем компьютере следующий человек чужих «недавних» не увидит, а сами id без доступа к
// чату ничего не раскрывают. Хранилища нет (приватный режим) — список просто пустой.

const KEY_PREFIX = 'sh_chat_recent_search:'
export const RECENT_SEARCH_LIMIT = 20

function keyOf(userId: string): string {
  return `${KEY_PREFIX}${userId}`
}

export function readRecentSearch(userId: string | undefined): string[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(keyOf(userId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string').slice(0, RECENT_SEARCH_LIMIT)
      : []
  } catch {
    return []
  }
}

function write(userId: string, ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(keyOf(userId))
    else localStorage.setItem(keyOf(userId), JSON.stringify(ids))
  } catch {
    // Хранилище недоступно или переполнено: «недавние» — удобство, без них поиск работает.
  }
}

/** Поднять чат в начало «недавних»; возвращает новый список. */
export function pushRecentSearch(userId: string | undefined, chatId: string): string[] {
  if (!userId) return []
  const next = [chatId, ...readRecentSearch(userId).filter((id) => id !== chatId)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  )
  write(userId, next)
  return next
}

export function removeRecentSearch(userId: string | undefined, chatId: string): string[] {
  if (!userId) return []
  const next = readRecentSearch(userId).filter((id) => id !== chatId)
  write(userId, next)
  return next
}

export function clearRecentSearch(userId: string | undefined): void {
  if (userId) write(userId, [])
}
