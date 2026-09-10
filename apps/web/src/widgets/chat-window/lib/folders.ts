import type { ChatFolder, ChatListItem, ChatTypeValue } from '../../../entities/chat'

// Папки чатов (Telegram-стиль §2) — клиентский фильтр поверх готового GET /chats.
//
// Встроенные папки считаются по типу чата и в БД не хранятся: они одинаковы для всех и меняются
// вместе с ролями, а не по воле пользователя. Пользовательские приходят из GET /chats/folders —
// это личные ярлыки, и они всегда идут после встроенных, чтобы «Все» оставалось на месте.

export interface BuiltinFolder {
  id: string
  kind: 'builtin'
  types?: ChatTypeValue[]
  unread?: boolean
  // Вкладка непринятых запросов на переписку (§50) — единственное место, где они видны.
  requests?: boolean
  // Вкладка архива — тоже единственное место, где видны убранные туда чаты.
  archive?: boolean
}

export interface UserFolder {
  id: string
  kind: 'user'
  name: string
  chatIds: string[]
}

export type FolderTab = BuiltinFolder | UserFolder

export const BUILTIN_FOLDERS: BuiltinFolder[] = [
  { id: 'folderAll', kind: 'builtin' },
  { id: 'folderRequests', kind: 'builtin', requests: true },
  { id: 'folderArchive', kind: 'builtin', archive: true },
  { id: 'folderUnread', kind: 'builtin', unread: true },
  { id: 'folderPersonal', kind: 'builtin', types: ['PRIVATE'] },
  { id: 'folderGroups', kind: 'builtin', types: ['GROUP', 'GROUP_OFFICIAL'] },
  { id: 'folderSubjects', kind: 'builtin', types: ['SUBJECT'] },
  { id: 'folderDean', kind: 'builtin', types: ['DEAN'] },
  { id: 'folderUniversity', kind: 'builtin', types: ['FACULTY', 'SUPPORT'] },
]

// Чат «в общем списке»: не непринятый запрос и не убранный в архив. Обе вкладки
// исключающие — чат виден либо там, либо в остальных вкладках, но не в обеих сразу.
function isOpen(c: ChatListItem): boolean {
  return !c.requestIncoming && !c.archived
}

/**
 * Вкладки для текущего списка чатов.
 *
 * Встроенная тип-папка показывается только если в неё что-то попадает — иначе бар зашумлён
 * вкладками, которые у этой роли всегда пусты. Пользовательскую папку показываем даже пустой:
 * человек создал её сам, и исчезающая вкладка выглядела бы как потеря данных.
 */
export function buildFolderTabs(chats: ChatListItem[], userFolders: ChatFolder[]): FolderTab[] {
  const builtins = BUILTIN_FOLDERS.filter((f) => {
    // «Запросы» и «Архив» показываются, только когда в них что-то есть: пустая вкладка
    // была бы постоянным напоминанием ни о чём.
    if (f.requests) return chats.some((c) => c.requestIncoming)
    if (f.archive) return chats.some((c) => c.archived && !c.requestIncoming)
    return (
      f.id === 'folderAll' || f.unread || chats.some((c) => isOpen(c) && f.types?.includes(c.type))
    )
  })
  const user: UserFolder[] = [...userFolders]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((f) => ({ id: f.id, kind: 'user', name: f.name, chatIds: f.chatIds }))
  return [...builtins, ...user]
}

/** Чаты выбранной вкладки. Неизвестная вкладка (папку удалили) = «Все», а не пустой список. */
export function filterChatsByTab(
  chats: ChatListItem[],
  tab: FolderTab | undefined,
): ChatListItem[] {
  // Непринятый входящий запрос (§50) живёт только во вкладке «Запросы»: в «Все», «Личные»
  // и пользовательские папки он не попадает — согласия на переписку ещё не было. Архив —
  // так же: его вкладка единственная, иначе убирать чат было бы бессмысленно.
  if (tab?.kind === 'builtin' && tab.requests) return chats.filter((c) => c.requestIncoming)
  if (tab?.kind === 'builtin' && tab.archive) {
    return chats.filter((c) => c.archived && !c.requestIncoming)
  }
  const open = chats.filter(isOpen)
  if (!tab || tab.id === 'folderAll') return open
  if (tab.kind === 'user') {
    const ids = new Set(tab.chatIds)
    return open.filter((c) => ids.has(c.id))
  }
  if (tab.unread) return open.filter((c) => c.unreadCount > 0)
  return open.filter((c) => tab.types?.includes(c.type))
}

/** Подпись вкладки: у встроенной — ключ i18n, у пользовательской — её имя как есть. */
export function folderTabLabel(tab: FolderTab, t: (key: string) => string): string {
  return tab.kind === 'user' ? tab.name : t(tab.id)
}
