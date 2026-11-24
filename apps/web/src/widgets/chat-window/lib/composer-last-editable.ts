import { MESSAGE_EDIT_WINDOW_MS } from '@studenthub/shared-config'
import type { ChatMessage } from '../../../entities/chat'

/**
 * Последнее своё сообщение, которое ещё можно править, — для «↑ в пустом поле» (Telegram).
 * Те же условия, что у пункта «Изменить» в меню сообщения: своё, не пересланное, в окне
 * правки. Сверх того — только с текстом: у опроса, стикера, чек-листа, геопозиции и контакта
 * править в поле ввода нечего, а неотправленный (`tmp:`) пузырь сервер ещё не знает.
 */
export function lastEditableMessage(
  messages: readonly ChatMessage[] | undefined,
  myId: string | undefined,
  now = Date.now(),
): ChatMessage | null {
  if (!messages || !myId) return null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (!m || m.senderId !== myId || m.systemType) continue
    // Дальше — только более старые: если последнее своё уже нельзя править, то и их нельзя.
    if (now - new Date(m.createdAt).getTime() >= MESSAGE_EDIT_WINDOW_MS) return null
    if (m.id.startsWith('tmp:') || m.forwardedFromId) continue
    if (m.poll || m.checklist || m.location || m.contact) continue
    if (!m.content.trim()) continue
    return m
  }
  return null
}
