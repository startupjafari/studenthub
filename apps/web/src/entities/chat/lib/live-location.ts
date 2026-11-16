import type { ChatMessage, MessageLocation } from '../model/types'

/** Как часто карточка трансляции пересчитывает «обновлено N мин назад» и срок, мс. */
export const LIVE_LOCATION_TICK_MS = 30_000

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Идёт ли трансляция: `liveUntil` задан и ещё не наступил. Остановленная трансляция
 * (сервер ставит `liveUntil = now`) и истёкшая — уже обычная точка.
 */
export function isLiveLocation(location: MessageLocation, now: number = Date.now()): boolean {
  const until = timeOf(location.liveUntil)
  return until !== null && until > now
}

/**
 * Сколько полных минут прошло с последнего сдвига точки. Нет отметки — `null`
 * (подпись «обновлено» тогда не показывается). Часы клиента могут отставать от сервера —
 * отрицательное значение прижимаем к нулю.
 */
export function liveUpdatedMinutesAgo(
  location: MessageLocation,
  now: number = Date.now(),
): number | null {
  const at = timeOf(location.liveUpdatedAt)
  if (at === null) return null
  return Math.max(0, Math.floor((now - at) / 60_000))
}

/**
 * Положить новую точку (`location:updated`) в загруженную ленту чата. Чужого чата и
 * незагруженного сообщения не трогает — возвращает тот же массив, чтобы React Query не
 * перерисовывал ленту впустую.
 */
export function applyLocationUpdate(
  messages: ChatMessage[] | undefined,
  update: { chatId: string; messageId: string; location: MessageLocation },
): ChatMessage[] | undefined {
  if (!messages) return messages
  let changed = false
  const next = messages.map((m) => {
    if (m.id !== update.messageId || m.chatId !== update.chatId) return m
    changed = true
    return { ...m, location: update.location }
  })
  return changed ? next : messages
}
