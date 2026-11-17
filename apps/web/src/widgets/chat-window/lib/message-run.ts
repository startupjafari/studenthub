// Группировка ленты в серии одного автора (Telegram-стиль). Серия задаёт форму пузырей:
// хвостик и аватар — только у последнего, имя — у первого, внутренние углы скруглены меньше.
//
// Серию рвёт то же, что и в Telegram: другой автор, служебное сообщение, смена календарного
// дня (между ними стоит пометка даты), разделитель «Непрочитанные» и пауза дольше 10 минут —
// иначе утренний вопрос и вечерний ответ того же человека слипались бы в одну реплику.

/** Пауза между сообщениями, после которой начинается новая серия, мс. */
export const RUN_GAP_MS = 10 * 60 * 1000

type RunMessage = {
  id: string
  senderId: string
  createdAt: string
  systemType: string | null
}

/** `b` продолжает серию `a` (b идёт сразу за a). */
export function continuesRun(a: RunMessage, b: RunMessage, unreadDividerId?: string | null) {
  if (a.systemType || b.systemType) return false
  if (a.senderId !== b.senderId) return false
  if (unreadDividerId && b.id === unreadDividerId) return false
  const ta = new Date(a.createdAt)
  const tb = new Date(b.createdAt)
  if (ta.toDateString() !== tb.toDateString()) return false
  return tb.getTime() - ta.getTime() <= RUN_GAP_MS
}

export type MessageRunPosition = {
  first: boolean
  last: boolean
  /** id первого сообщения серии — только у последнего и только если серия длиннее одного. */
  startId: string | undefined
}

/**
 * Положение сообщения `i` в серии. Начало серии ищется только для последнего сообщения —
 * так весь проход по ленте остаётся линейным: каждая серия просматривается один раз.
 */
export function messageRunPosition(
  list: readonly RunMessage[],
  i: number,
  unreadDividerId?: string | null,
): MessageRunPosition {
  const m = list[i]
  if (!m) return { first: true, last: true, startId: undefined }
  const prev = list[i - 1]
  const next = list[i + 1]
  const first = !prev || !continuesRun(prev, m, unreadDividerId)
  const last = !next || !continuesRun(m, next, unreadDividerId)
  let startId: string | undefined
  if (last && !first) {
    let j = i
    while (j > 0) {
      const a = list[j - 1]
      const b = list[j]
      if (!a || !b || !continuesRun(a, b, unreadDividerId)) break
      j--
    }
    startId = list[j]?.id
  }
  return { first, last, startId }
}
