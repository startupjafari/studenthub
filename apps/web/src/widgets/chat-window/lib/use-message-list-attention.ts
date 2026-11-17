'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useRealtimeEvent } from '../../../shared/realtime'
import type { ChatMessage } from '../../../entities/chat'
import { newForeignReactions, unreadMentionIds, type MentionTarget } from './message-list-unread'

/** Видна ли строка сообщения в ленте сейчас (над панелью ввода, а не под ней). */
export function isRowVisible(scroller: HTMLElement | null, messageId: string): boolean {
  if (!scroller) return false
  // getElementById, а не querySelector: у оптимистичных пузырей id вида `tmp:...`.
  const row = document.getElementById(`msg-${messageId}`)
  if (!row || !scroller.contains(row)) return false
  const box = scroller.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  // Нижний отступ ленты — место под плавающей панелью ввода: то, что под ней, не видно.
  const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
  return r.bottom > box.top && r.top < box.bottom - padBottom
}

/**
 * Кнопки «к упоминанию» и «к реакции» над кнопкой «вниз» (Telegram).
 *
 * Упоминания считаются по загруженной ленте и отметке «прочитано до» — гаснут ровно тогда,
 * когда сообщение проехало через экран. «Прочитать всё» по правому клику прячет их локально:
 * отдельной отметки «упоминание прочитано» у сервера нет.
 *
 * Реакции — только живые: чужая реакция на моё сообщение, пришедшая, пока сообщения не было
 * на экране. Сервер не хранит «непрочитанные реакции», поэтому после перезагрузки страницы
 * список пуст — это граница возможностей текущего API, а не потеря данных.
 */
export function useMessageListAttention({
  chatId,
  me,
  messages,
  readUpTo,
  scrollRef,
}: {
  chatId: string | null
  me: MentionTarget | null | undefined
  messages: readonly ChatMessage[] | undefined
  readUpTo: string | null
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const myId = me?.id
  const [dismissedMentions, setDismissedMentions] = useState<ReadonlySet<string>>(new Set())
  const [unseenReactions, setUnseenReactions] = useState<string[]>([])

  // Смена чата — всё локальное заново.
  useEffect(() => {
    setDismissedMentions(new Set())
    setUnseenReactions([])
  }, [chatId])

  // Лента на момент прошлого рендера: событие о реакции приходит между рендерами, и сравнивать
  // его надо с тем, что было на экране до него, а не с кэшем, который другой обработчик того
  // же события, возможно, уже обновил.
  const shownRef = useRef<readonly ChatMessage[] | undefined>(messages)
  shownRef.current = messages

  useRealtimeEvent<{ message: ChatMessage; chatId: string }>('message:reaction', (payload) => {
    if (!chatId || payload.chatId !== chatId || !myId) return
    const m = payload.message
    if (m.senderId !== myId) return
    const before = shownRef.current?.find((x) => x.id === m.id)
    if (!before) return
    if (newForeignReactions(before.reactions, m.reactions, myId).length === 0) return
    if (isRowVisible(scrollRef.current, m.id)) return
    setUnseenReactions((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]))
  })

  // Реакция, ради которой копили, снята, или сообщение удалено — убираем из очереди.
  useEffect(() => {
    if (unseenReactions.length === 0 || !messages) return
    const alive = unseenReactions.filter((id) => {
      const m = messages.find((x) => x.id === id)
      return !!m && m.reactions.some((r) => r.userId !== myId)
    })
    if (alive.length !== unseenReactions.length) setUnseenReactions(alive)
  }, [messages, unseenReactions, myId])

  // Увидел сообщение прокруткой — реакция просмотрена.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || unseenReactions.length === 0) return
    let frame: number | null = null
    const sweep = (): void => {
      frame = null
      setUnseenReactions((prev) => {
        const left = prev.filter((id) => !isRowVisible(el, id))
        return left.length === prev.length ? prev : left
      })
    }
    const onScroll = (): void => {
      if (frame === null) frame = requestAnimationFrame(sweep)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [scrollRef, unseenReactions.length, chatId])

  const mentions = useMemo(
    () => unreadMentionIds(messages ?? [], readUpTo, me, dismissedMentions),
    [messages, readUpTo, me, dismissedMentions],
  )

  const readAllMentions = useCallback(
    () => setDismissedMentions((prev) => new Set([...prev, ...mentions])),
    [mentions],
  )
  const readAllReactions = useCallback(() => setUnseenReactions([]), [])
  /** Следующая цель «к реакции» — и сразу снимаем её: человек к ней уже едет. */
  const takeNextReaction = useCallback((): string | null => {
    const next = unseenReactions[0] ?? null
    if (next) setUnseenReactions((prev) => prev.slice(1))
    return next
  }, [unseenReactions])

  return {
    mentionIds: mentions,
    reactionIds: unseenReactions,
    readAllMentions,
    readAllReactions,
    takeNextReaction,
  }
}
