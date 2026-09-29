// Сводка о работе очереди: один текст на два места.
//
// Её шлёт крон в назначенный админом час и отдаёт команда бота `/digest` по запросу.
// Пока текст собирался в кроне, «что сейчас с очередью» и «что было в сводке» отвечали
// по-разному на один и тот же вопрос — расхождение, которое видно только человеку и
// только в неудачный момент.
//
// Содержимого здесь нет и быть не может: только числа и имя дежурного — он из команды
// платформы, а не тот, о ком жалуются. Правило то же, что у остальных сообщений в
// Telegram (см. telegram-notify.service.ts).

/** Что происходит с одним видом работы: очередь сейчас и движение за сутки. */
export interface QueueSnapshot {
  /** Сколько ждёт разбора прямо сейчас. */
  count: number
  /** Когда появилось самое старое из ждущих; null — очередь пуста. */
  oldestAt: Date | null
  /** Сколько пришло за сутки. */
  created: number
  /** Сколько разобрано или закрыто за сутки. */
  closed: number
}

/** Возраст по-человечески: минуты до часа, дальше часы, дальше сутки. */
export function humanAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ч`
  return `${Math.floor(hours / 24)} сут`
}

/**
 * Текст сводки.
 *
 * Строка «за сутки» стоит рядом с очередью, потому что одно без другого не читается:
 * ноль в очереди после сорока разобранных жалоб и ноль в тихий день — разные новости, а
 * выглядели они одинаково.
 */
export function digestText(input: {
  complaints: QueueSnapshot
  tickets: QueueSnapshot
  /** Имя дежурного; null — дежурного нет. */
  dutyName: string | null
  now?: Date
}): string {
  const { complaints, tickets, dutyName } = input
  const now = input.now ?? new Date()

  const lines = [
    'Сводка за сутки',
    '',
    `Жалобы: в очереди ${complaints.count}, пришло ${complaints.created}, разобрано ${complaints.closed}`,
    `Обращения: открыто ${tickets.count}, пришло ${tickets.created}, закрыто ${tickets.closed}`,
  ]

  // Возраст показываем только когда очередь непуста: «старейшее ждёт — 0 мин» это строка
  // ни о чём.
  const oldest = [complaints.oldestAt, tickets.oldestAt]
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0]
  if (oldest) lines.push(`Старейшее ждёт: ${humanAge(now.getTime() - oldest.getTime())}`)

  lines.push(dutyName ? `Дежурит: ${dutyName}` : 'Дежурного нет — уведомления уходят всей команде')
  return lines.join('\n')
}
