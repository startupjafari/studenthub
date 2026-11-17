'use client'

import { useRef } from 'react'
import { useRealtimeEvent } from '../../../shared/realtime'
import type { ChatMessage, MessageReaction } from '../../../entities/chat'
import { popReactionChips } from './reaction-flight'

const reactionKey = (r: Pick<MessageReaction, 'userId' | 'emoji'>): string =>
  `${r.userId}:${r.emoji}`

/** Чужие реакции, которых не было в прошлой версии сообщения. */
export function newForeignReactions(
  before: readonly MessageReaction[] | undefined,
  after: readonly MessageReaction[],
  myId: string | undefined,
): MessageReaction[] {
  const known = new Set((before ?? []).map(reactionKey))
  return after.filter((r) => r.userId !== myId && !known.has(reactionKey(r)))
}

/**
 * Пришедшая чужая реакция на моё сообщение — короткое подпрыгивание её чипа (Telegram).
 *
 * Только живые события, а не всё, что есть в ленте: реакции, которые уже стояли, когда
 * переписку открыли, не «приходят». Сравнение — с лентой прошлого рендера, а не с кэшем:
 * обработчик того же события в окне чата, возможно, уже положил новое сообщение в кэш
 * (тот же приём, что у кнопки «к реакции», use-message-list-attention).
 */
export function useIncomingReactionPop({
  chatId,
  myId,
  messages,
}: {
  chatId: string | null
  myId: string | undefined
  messages: readonly ChatMessage[] | undefined
}): void {
  const shownRef = useRef(messages)
  shownRef.current = messages

  useRealtimeEvent<{ message: ChatMessage; chatId: string }>('message:reaction', (payload) => {
    if (!chatId || payload.chatId !== chatId || !myId) return
    const m = payload.message
    if (m.senderId !== myId) return
    const before = shownRef.current?.find((x) => x.id === m.id)
    if (!before) return
    const fresh = newForeignReactions(before.reactions, m.reactions, myId)
    if (fresh.length > 0) popReactionChips(m.id, new Set(fresh.map((r) => r.emoji)))
  })
}
