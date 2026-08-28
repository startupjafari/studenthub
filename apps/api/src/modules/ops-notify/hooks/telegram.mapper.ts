import { obj, str, type HookPayload } from './ops-event.type'

// Разбор входящего апдейта Telegram (docs/TELEGRAM_BOT.md §6).
//
// Чистая функция, как и остальные мапперы (§7.3.3): проверка подлинности — в контроллере,
// исполнение — в `OpsCommandService`. Здесь только «что за команда и откуда».
//
// Апдейты приходят на любое сообщение в группе, а команд у бота четыре. Всё остальное —
// `null`: молчание, а не ошибка.

export interface OpsCommand {
  /** Команда без ведущего слэша и без `@имя_бота`: `status`, `quiet`. */
  command: string
  /** Аргумент: `2h`, `off`. Пустая строка, если его не было. */
  argument: string
  /** Чат, из которого пришла команда — сверяется с allowlist уже в обработчике. */
  chatId: string
  /** Тема, в которой её написали: ответ обязан прийти туда же, а не в общий поток. */
  threadId?: number
}

export function mapTelegramUpdate(payload: HookPayload): OpsCommand | null {
  // Правки сообщений игнорируем: команда, исполняемая при правке, — неожиданное поведение.
  const message = obj(payload, 'message')
  if (!message) return null

  const chatId = str(obj(message, 'chat'), 'id')
  const text = str(message, 'text')
  if (!chatId || !text?.startsWith('/')) return null

  const [head = '', ...rest] = text.trim().split(/\s+/)
  // В группах Telegram дописывает `@имя_бота` — для нас это та же команда.
  const command = head.slice(1).split('@')[0]?.toLowerCase()
  if (!command) return null

  const threadId = Number(str(message, 'message_thread_id'))

  return {
    command,
    argument: rest.join(' ').toLowerCase(),
    chatId,
    ...(Number.isFinite(threadId) && threadId > 0 ? { threadId } : {}),
  }
}
