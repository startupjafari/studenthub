import type { ChatTypeValue } from '@studenthub/shared-schemas'
import type { MediaStatus } from '../../../shared/api'
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
  // Отправлено «без сжатия» (§9): показывать строкой файла с расширением и размером, а не
  // превью, даже если mime картиночный. Выбор отправителя, не свойство байтов.
  asDocument?: boolean
  // Размеры изображения в пикселях (сервер считает их при загрузке): под снимок резервируется
  // точное место, пока идут байты. NULL/undefined — не картинка либо вложение старше полей.
  width?: number | null
  height?: number | null
  // Медиа-система: LQIP-заглушка (рисуется сразу, ещё до запроса ссылки), статус подготовки
  // вариантов и длительность видео/аудио. Варианты и HLS приходят со ссылкой на вложение.
  placeholder?: string | null
  mediaStatus?: MediaStatus
  durationMs?: number | null
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
  // У удалённого оригинала сервер текст не отдаёт — пустая строка и `deletedAt`.
  content: string
  deletedAt?: string | null
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
  title: string | null
  content: string
  authorId: string
  deletedAt: string | null
  // У снятого поста сервер ни автора, ни текста, ни обложки не отдаёт.
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null } | null
  media: { id: string; mime: string }[]
  _count: { comments: number; reactions: number }
}

/**
 * Сторис в сообщении: ответ на неё или пересылка (§3.4). Медиа — только тип: ссылки на
 * файл сторис в переписке нет, сторис открывается по `/stories/:id` с проверкой аудитории.
 * Истёкшая — без текста и фона; удалённая — `null` у сообщения.
 */
export interface SharedStoryPreview {
  id: string
  text: string | null
  background: string | null
  expiresAt: string
  authorId: string
  author: { id: string; firstName: string; lastName: string; avatarUrl: string | null }
  file: { mime: string } | null
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
  // Пояснение под вопросом; старый сервер поля не отдаёт.
  description?: string | null
  multiple: boolean
  anonymous: boolean
  allowRevote: boolean
  randomOrder: boolean
  closed: boolean
  options: ChatPollOptionStatic[]
}
/** Проголосовавший в неанонимном опросе (§39): у анонимного список всегда пуст. */
export interface PollVoter {
  id: string
  firstName: string
  lastName: string
  avatarUrl: string | null
}
// Результаты опроса для смотрящего (viewer-aware, анонимный — без личностей).
export interface PollResults {
  id: string
  anonymous: boolean
  multiple: boolean
  allowRevote: boolean
  closed: boolean
  totalVotes: number
  options: { id: string; text: string; order: number; votes: number; voters: PollVoter[] }[]
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
  // Процитированный фрагмент отвечаемого сообщения: клиент показывает его вместо начала
  // оригинала. Копия текста, а не смещения — оригинал могут отредактировать.
  replyQuote: string | null
  // Отправлено «без звука»: доставлено как обычно, уведомления по нему не создавались.
  silent: boolean
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
  // Сторис в сообщении и признак «это ответ на сторис» (а не пересылка). Ответ остаётся
  // ответом и после удаления сторис — тогда карточка пишет «сторис недоступна».
  sharedStory?: SharedStoryPreview | null
  sharedStoryReply?: boolean
  reactions: MessageReaction[]
  // Опрос (§38): не null → сообщение-опрос (рендерится как ChatPoll, не как текст).
  poll: ChatPoll | null
  // Особые сообщения (у них пустой content): геопозиция, карточка контакта, чек-лист,
  // стикер каталога. Необязательны — их нет у оптимистичных пузырей и у старого сервера.
  location?: MessageLocation | null
  contact?: MessageContact | null
  checklist?: MessageChecklist | null
  sticker?: MessageSticker | null
  // Системное событие группы (§20): не null → служебное сообщение (member_added, title_changed, …).
  // sender = инициатор; systemMeta — денормализованные детали для текста.
  systemType: string | null
  systemMeta: { targetName?: string; title?: string } | null
}

export interface MessageLocation {
  lat: number
  lng: number
  title: string | null
  address: string | null
  // Трансляция геопозиции: до `liveUntil` точку двигает отправитель (`location:updated`).
  // null — обычная точка или трансляция, закончившаяся остановкой. Поля необязательны —
  // их нет у старого сервера и у оптимистичных пузырей.
  liveUntil?: string | null
  // Когда точка в последний раз сдвинулась.
  liveUpdatedAt?: string | null
  // Направление движения (градусы от севера) и точность (м) последней точки.
  heading?: number | null
  accuracy?: number | null
}

export interface MessageContact {
  name: string
  phones: string[]
  emails: string[]
  userId: string | null
}

export interface MessageChecklistItem {
  id: string
  text: string
  order: number
  done: boolean
  doneAt: string | null
  doneBy: { id: string; firstName: string; lastName: string } | null
  /** Кто добавил пункт; у ответов старого сервера поля нет. */
  createdById?: string
}

export interface MessageChecklist {
  id: string
  title: string
  othersCanAdd: boolean
  othersCanMark: boolean
  items: MessageChecklistItem[]
}

// Стикер каталога: картинку отдаёт подписанной ссылкой GET /chats/stickers/:id/url.
export interface MessageSticker {
  id: string
  setId: string
  emoji: string | null
  width: number | null
  height: number | null
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
  width?: number | null
  height?: number | null
  placeholder?: string | null
  durationMs?: number | null
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
  // Описание группы: назначение чата, правила, ссылки. Показывается в панели информации.
  // Есть только у пользовательских GROUP — в остальных типах сервер всегда отдаёт null.
  description: string | null
  // Аватар группы (публичный URL) или null → показываем цветной кружок с инициалами.
  avatarUrl: string | null
  subject: string | null
  memberCount: number
  lastMessage: ChatMessage | null
  unread: boolean
  // Число непрочитанных сообщений (для бейджа-счётчика).
  unreadCount: number
  muted: boolean
  // §17: чат заглушён, но ответы мне и упоминания меня уведомление всё равно создают.
  mutedImportantOnly: boolean
  // Чат закреплён «у себя» (Telegram-стиль): показывается сверху списка. Персонально.
  pinned: boolean
  // Когда закреплён — сквозную сортировку «закреплённые сверху» делает клиент поверх
  // всех загруженных страниц (см. sortChats): страница приходит по updatedAt.
  pinnedAt: string | null
  // Убран в архив «у себя»: живёт только во вкладке «Архив» и не считается в бейдже.
  archived: boolean
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
  // Запрос на переписку (§50). incoming — мне написал не-друг и я решаю: чат виден только
  // во вкладке «Запросы», вместо поля ввода — «Принять»/«Отклонить». outgoing — это я
  // написал и жду принятия: чат обычный, но с пометкой «запрос ещё не принят».
  requestIncoming: boolean
  requestOutgoing: boolean
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

/** Пользовательская папка чатов (§2): личный ярлык поверх готового списка чатов. */
export interface ChatFolder {
  id: string
  name: string
  position: number
  chatIds: string[]
}
