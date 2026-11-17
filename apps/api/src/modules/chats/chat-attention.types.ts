import type { ChatType, Prisma } from '@prisma/client'

/** Счётчики «ждёт внимания» одного чата для смотрящего (Telegram: unreadMentionsCount и т.п.). */
export interface ChatAttentionCounts {
  unreadMentionsCount: number
  unreadReactionsCount: number
}

/** Поля нового или исправленного сообщения, по которым решается, кого оно упоминает. */
export interface AttentionMessage {
  id: string
  senderId: string
  content: string
  systemType: string | null
  forwardedFromId: string | null
  replyTo: { senderId: string } | null
}

/**
 * Связь домена чатов с непрочитанными упоминаниями и реакциями (ChatAttentionService).
 *
 * Сервис чатов вызывает эти методы из своих путей (отправка, правка, реакция, удаление,
 * прочтение), а реализацию регистрирует ChatAttentionService при старте модуля — как правила
 * поддержки (`registerSupportHook`): прямая зависимость через DI замкнула бы кольцо, а
 * конструктор сервиса чатов и его тесты остаются прежними. Сбой любого метода не роняет
 * основное действие — сообщение уже сохранено (вызывающий ловит ошибку и пишет в лог).
 */
export interface ChatAttentionHook {
  /** Новое сообщение: упоминания и ответы → непрочитанные упоминания адресатов. */
  onMessageSent(event: {
    chatId: string
    chatType: ChatType | null
    message: AttentionMessage
  }): Promise<void>
  /**
   * Правка текста: упомянутые впервые получают непрочитанное упоминание, у тех, кого из текста
   * убрали, непрочитанное снимается. Кого упоминал и прежний текст, правка не трогает: прочитанное
   * упоминание не должно снова стать непрочитанным оттого, что автор поправил опечатку.
   */
  onMessageEdited(event: {
    chatId: string
    message: AttentionMessage
    previousContent: string
  }): Promise<void>
  /** Реакция поставлена или заменена (`added`) либо снята участником `reactorId`. */
  onReactionChanged(event: {
    chatId: string
    messageId: string
    reactorId: string
    added: boolean
  }): Promise<void>
  /**
   * Сообщения пропали: удалены у всех (`userId` не задан) или скрыты «у себя» одним
   * участником (`userId`). Их непрочитанные упоминания и реакции больше не ждут внимания.
   */
  onMessagesGone(event: { chatId: string; messageIds: string[]; userId?: string }): Promise<void>
  /** Участник очистил историю «у себя» — его счётчики в чате пересчитываются. */
  onHistoryCleared(event: { chatId: string; userId: string }): Promise<void>
  /** «Прочитать» чаты целиком (POST /chats/read): упоминания и реакции тоже прочитаны. */
  onChatsRead(event: { userId: string; chatIds: string[] }): Promise<void>
  /**
   * Счётчики для элементов списка чатов. `messageWhere` чата — видимость сообщений для
   * смотрящего (очистка «у себя»), как у истории и счётчика непрочитанного.
   */
  countsFor(
    userId: string,
    chats: { chatId: string; messageWhere: Prisma.MessageWhereInput }[],
  ): Promise<Map<string, ChatAttentionCounts>>
}
