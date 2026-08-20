import type { ChatTypeValue } from '@studenthub/shared-schemas'
export type { ChatTypeValue }

// Вложение сообщения (Ф9+): presigned-URL получаем лениво по id (GET /chats/attachments/:id/url).
export interface MessageAttachment {
  id: string
  mime: string
  size: number
  // Оригинальное имя файла (Ф9+); может отсутствовать у старых вложений.
  name?: string | null
  // Спойлер (§34): медиа размыто до клика.
  spoiler?: boolean
  // ── Клиентские поля для оптимистичного рендера (Telegram-стиль), сервер их НЕ шлёт ──
  // object-URL локального файла/записи: показываем нужный тип сообщения мгновенно, до ответа сервера.
  // Переносится и на реальное сообщение после примирения — чтобы не перезагружать медиа с сервера.
  localUrl?: string
  // Идёт загрузка на сервер — рисуем оверлей прогресса поверх вложения.
  uploading?: boolean
  // Прогресс загрузки 0..1 (для оверлея).
  progress?: number
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

// Опрос в чате (§38): статика на сообщении. Результаты (счётчики + мой голос) — отдельным запросом.
export interface ChatPollOptionStatic {
  id: string
  text: string
  order: number
}
export interface ChatPoll {
  id: string
  question: string
  multiple: boolean
  anonymous: boolean
  allowRevote: boolean
  randomOrder: boolean
  closed: boolean
  options: ChatPollOptionStatic[]
}
// Результаты опроса для смотрящего (viewer-aware, анонимный — без личностей).
export interface PollResults {
  id: string
  anonymous: boolean
  multiple: boolean
  allowRevote: boolean
  closed: boolean
  totalVotes: number
  options: { id: string; text: string; order: number; votes: number }[]
  myOptionIds: string[]
}

export interface ChatMessage {
  id: string
  chatId: string
  // Монотонная позиция в чате: максимум по загруженным сообщениям — точка догона после обрыва
  // связи (GET /chats/:id/updates). У оптимистичных «pending» пузырей seq ещё нет.
  seq: number
  senderId: string
  content: string
  replyToId: string | null
  forwardedFromId: string | null
  editedAt: string | null
  pinnedAt: string | null
  createdAt: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  // Инлайн-превью первой ссылки (заполняется асинхронно; приходит по message:updated).
  linkPreview: LinkPreview | null
  media: MessageAttachment[]
  replyTo: MessageReplyPreview | null
  forwardedFrom: MessageForwardOrigin | null
  sharedPost: SharedPostPreview | null
  reactions: MessageReaction[]
  // Опрос (§38): не null → сообщение-опрос (рендерится как ChatPoll, не как текст).
  poll: ChatPoll | null
  // Системное событие группы (§20): не null → служебное сообщение (member_added, title_changed, …).
  // sender = инициатор; systemMeta — денормализованные детали для текста.
  systemType: string | null
  systemMeta: { targetName?: string; title?: string } | null
}

// Инлайн-превью ссылки (OG-мета) в сообщении.
export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
}

// Общие материалы чата (§23, правый sidebar): вложение (media/file/voice).
export interface ChatMediaItem {
  id: string
  messageId: string
  name: string | null
  mime: string
  size: number
  hasPoster: boolean
  createdAt: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
}

// Общие материалы: сообщение со ссылкой (linkPreview).
export interface ChatLinkItem {
  messageId: string
  createdAt: string
  sender: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
  linkPreview: LinkPreview | null
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
  // Чат закреплён «у себя» (Telegram-стиль): показывается сверху списка. Персонально.
  pinned: boolean
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
  // Last-seen (§49): ISO времени ухода в оффлайн; null — онлайн или неизвестно.
  lastSeenAt: string | null
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
