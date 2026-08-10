import type { ChatTypeValue } from '@studenthub/shared-schemas'
export type { ChatTypeValue }

// Вложение сообщения (Ф9+): presigned-URL получаем лениво по id (GET /chats/attachments/:id/url).
export interface MessageAttachment {
  id: string
  mime: string
  size: number
  // Оригинальное имя файла (Ф9+); может отсутствовать у старых вложений.
  name?: string | null
}

// Краткая ссылка на сообщение, на которое отвечают (без вложенной цепочки).
export interface MessageReplyPreview {
  id: string
  content: string
  senderId: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

// Источник пересланного сообщения (Ф9+): чей текст переслали.
export interface MessageForwardOrigin {
  id: string
  senderId: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

export interface MessageReaction {
  emoji: string
  userId: string
  user: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
}

// Превью расшаренного поста в сообщении (share-to-chat): автор, текст, первая медиа-миниатюра.
export interface SharedPostPreview {
  id: string
  content: string
  authorId: string
  deletedAt: string | null
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  media: { id: string; mime: string }[]
  _count: { comments: number; reactions: number }
}

export interface ChatMessage {
  id: string
  chatId: string
  senderId: string
  content: string
  replyToId: string | null
  forwardedFromId: string | null
  editedAt: string | null
  pinnedAt: string | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  media: MessageAttachment[]
  replyTo: MessageReplyPreview | null
  forwardedFrom: MessageForwardOrigin | null
  sharedPost: SharedPostPreview | null
  reactions: MessageReaction[]
}

// Статус прочтения участником (#6): кто прочитал и до какого момента.
export interface ChatReadReceipt {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  lastReadAt: string | null
}

export interface ChatListItem {
  id: string
  type: ChatTypeValue
  title: string | null
  // Аватар группы (публичный URL) или null → показываем цветной кружок с инициалами.
  avatarUrl: string | null
  subject: string | null
  memberCount: number
  lastMessage: ChatMessage | null
  unread: boolean
  // Число непрочитанных сообщений (для бейджа-счётчика).
  unreadCount: number
  muted: boolean
  // Черновик сообщения (синхронизируется с сервером): восстанавливается при открытии чата.
  draft: string | null
  // Я — создатель группы (владелец): удаление группы, передача прав, назначение админов.
  isOwner: boolean
  // Я — админ группы: бан, смена аватара/названия, управление участниками.
  isAdmin: boolean
  // Личная блокировка (только PRIVATE): blocked — я заблокировал собеседника; blockedBy — он меня.
  blocked: boolean
  blockedBy: boolean
  // Собеседник онлайн (только PRIVATE) — индикатор-точка на аватаре в списке.
  online: boolean
  // Макс. время прочтения другими участниками — для статусов доставки своих сообщений.
  othersReadAt: string | null
  updatedAt: string
}

export interface PresenceEntry {
  userId: string
  online: boolean
}

export interface ChatMemberInfo {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  role: string
  online: boolean
  // Забанен создателем группы (Ф9+).
  banned: boolean
  // Админ группы (Ф9+).
  isAdmin: boolean
}

// Заблокированный пользователь (экран управления блокировками).
export interface BlockedUser {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
  blockedAt: string
}
