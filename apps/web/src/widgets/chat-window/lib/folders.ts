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
  { id: 'folderUnread', kind: 'builtin', unread: true },
  { id: 'folderPersonal', kind: 'builtin', types: ['PRIVATE'] },
  { id: 'folderGroups', kind: 'builtin', types: ['GROUP', 'GROUP_OFFICIAL'] },
  { id: 'folderSubjects', kind: 'builtin', types: ['SUBJECT'] },
  { id: 'folderDean', kind: 'builtin', types: ['DEAN'] },
  { id: 'folderUniversity', kind: 'builtin', types: ['FACULTY', 'SUPPORT'] },
]

/**
 * Вкладки для текущего списка чатов.
 *
 * Встроенная тип-папка показывается только если в неё что-то попадает — иначе бар зашумлён
 * вкладками, которые у этой роли всегда пусты. Пользовательскую папку показываем даже пустой:
 * человек создал её сам, и исчезающая вкладка выглядела бы как потеря данных.
 */
export function buildFolderTabs(chats: ChatListItem[], userFolders: ChatFolder[]): FolderTab[] {
  const builtins = BUILTIN_FOLDERS.filter(
    (f) => f.id === 'folderAll' || f.unread || chats.some((c) => f.types?.includes(c.type)),
  )
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
  if (!tab || tab.id === 'folderAll') return chats
  if (tab.kind === 'user') {
    const ids = new Set(tab.chatIds)
    return chats.filter((c) => ids.has(c.id))
  }
  if (tab.unread) return chats.filter((c) => c.unreadCount > 0)
  return chats.filter((c) => tab.types?.includes(c.type))
}

/** Подпись вкладки: у встроенной — ключ i18n, у пользовательской — её имя как есть. */
export function folderTabLabel(tab: FolderTab, t: (key: string) => string): string {
  return tab.kind === 'user' ? tab.name : t(tab.id)
}
