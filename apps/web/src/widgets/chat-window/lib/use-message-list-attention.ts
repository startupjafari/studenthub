'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtimeEvent } from '../../../shared/realtime'
import {
  chatKeys,
  fetchChatAttention,
  readChatAttentionRequest,
  type ChatAttentionCounts,
  type ChatAttentionKind,
  type ChatAttentionQueue,
  type ChatListItem,
  type ChatMessage,
} from '../../../entities/chat'
import {
  isQueueStale,
  pendingTargets,
  withAttentionCounts,
  withAttentionRead,
  type AttentionKey,
} from './message-list-unread'

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

const KINDS: readonly ChatAttentionKind[] = ['mentions', 'reactions']
const COUNT_KEY: Record<ChatAttentionKind, AttentionKey> = {
  mentions: 'unreadMentionsCount',
  reactions: 'unreadReactionsCount',
}
/** Показанные сообщения уходят на сервер пачкой: прокрутка открывает их по нескольку за кадр. */
const READ_FLUSH_MS = 400

type ReadSets = Record<ChatAttentionKind, ReadonlySet<string>>
const emptyRead = (): ReadSets => ({ mentions: new Set(), reactions: new Set() })

/**
 * Кнопки «к упоминанию» и «к реакции» над кнопкой «вниз» и счётчики «@»/«♥» списка чатов
 * (Telegram) — на серверных данных.
 *
 * Счётчики — из элемента списка (`unreadMentionsCount` / `unreadReactionsCount`), живут по
 * событию `chat:attention` на всех устройствах. Цели кнопок — очередь
 * `GET /chats/:id/{mentions|reactions}/unread`, старые первыми. Упоминание или реакция
 * прочитаны, когда сообщение показалось в ленте (или к нему поехали по кнопке): отметка
 * уходит на сервер пачкой, счётчик в списке убавляется сразу. «Прочитать всё» по правому
 * клику на кнопке — тоже на сервер.
 *
 * В отличие от отметки «прочитано до», пролистанное кнопкой «вниз» упоминание остаётся
 * непрочитанным, пока сообщение не окажется на экране, — как в Telegram.
 */
export function useMessageListAttention({
  chatId,
  chat,
  messages,
  scrollRef,
  canRead,
}: {
  chatId: string | null
  chat: ChatListItem | undefined
  messages: readonly ChatMessage[] | undefined
  scrollRef: RefObject<HTMLDivElement | null>
  /** Можно ли сейчас отмечать прочитанным: не «открыть без прочтения», вкладка видна. */
  canRead: () => boolean
}) {
  const qc = useQueryClient()
  const mentionCount = chat?.unreadMentionsCount ?? 0
  const reactionCount = chat?.unreadReactionsCount ?? 0

  const mentionQueue = useQuery({
    queryKey: chatKeys.attention(chatId ?? '', 'mentions'),
    queryFn: () => fetchChatAttention(chatId as string, 'mentions'),
    enabled: !!chatId && mentionCount > 0,
    staleTime: 30_000,
  })
  const reactionQueue = useQuery({
    queryKey: chatKeys.attention(chatId ?? '', 'reactions'),
    queryFn: () => fetchChatAttention(chatId as string, 'reactions'),
    enabled: !!chatId && reactionCount > 0,
    staleTime: 30_000,
  })

  // Прочитанное на этом устройстве, пока сервер не подтвердил: очередь его уже не предлагает.
  const [read, setRead] = useState<ReadSets>(emptyRead)
  const readRef = useRef(read)
  readRef.current = read
  // Неотправленные отметки — с чатом, к которому они относятся: смена чата их не теряет.
  const outboxRef = useRef<{ chatId: string; ids: Record<ChatAttentionKind, Set<string>> } | null>(
    null,
  )
  const flushTimerRef = useRef<number | null>(null)

  const flush = useCallback((): void => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const box = outboxRef.current
    outboxRef.current = null
    if (!box) return
    for (const kind of KINDS) {
      const ids = [...box.ids[kind]]
      if (ids.length === 0) continue
      // Ответ не применяем: те же счётчики придут событием `chat:attention`, а ответ на
      // раннюю пачку перетёр бы оптимистичное уменьшение по более поздней.
      readChatAttentionRequest(box.chatId, kind, ids).catch(() => {
        void qc.invalidateQueries({ queryKey: chatKeys.list() })
        void qc.invalidateQueries({ queryKey: chatKeys.attention(box.chatId, kind) })
      })
    }
  }, [qc])

  // Смена чата — отправляем накопленное по прошлому и начинаем с чистого листа.
  useEffect(() => {
    setRead(emptyRead())
    return () => flush()
  }, [chatId, flush])

  const markRead = useCallback(
    (kind: ChatAttentionKind, ids: string[]): void => {
      if (!chatId || ids.length === 0) return
      setRead((prev) => ({ ...prev, [kind]: new Set([...prev[kind], ...ids]) }))
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        old ? withAttentionRead(old, chatId, COUNT_KEY[kind], ids.length) : old,
      )
      const box =
        outboxRef.current?.chatId === chatId
          ? outboxRef.current
          : { chatId, ids: { mentions: new Set<string>(), reactions: new Set<string>() } }
      if (outboxRef.current && outboxRef.current.chatId !== chatId) flush()
      for (const id of ids) box.ids[kind].add(id)
      outboxRef.current = box
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flush, READ_FLUSH_MS)
      }
    },
    [chatId, qc, flush],
  )

  const mentionIds = useMemo(
    () => pendingTargets(mentionQueue.data, read.mentions),
    [mentionQueue.data, read.mentions],
  )
  const reactionIds = useMemo(
    () => pendingTargets(reactionQueue.data, read.reactions),
    [reactionQueue.data, read.reactions],
  )

  // Показанное в ленте — прочитано. Проверяем при прокрутке (раз в кадр) и когда меняется
  // лента или очередь: окно вокруг цели подгрузилось, пришло новое упоминание у низа.
  const sweepRef = useRef<() => void>(() => {})
  sweepRef.current = () => {
    const el = scrollRef.current
    if (!el || !messages?.length || !canRead()) return
    const loaded = new Set(messages.map((m) => m.id))
    const seen = (ids: string[]) => ids.filter((id) => loaded.has(id) && isRowVisible(el, id))
    const m = seen(mentionIds)
    const r = seen(reactionIds)
    if (m.length > 0) markRead('mentions', m)
    if (r.length > 0) markRead('reactions', r)
  }
  useEffect(() => {
    if (mentionIds.length === 0 && reactionIds.length === 0) return
    const frame = requestAnimationFrame(() => sweepRef.current())
    return () => cancelAnimationFrame(frame)
  }, [messages, mentionIds, reactionIds])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame: number | null = null
    const onScroll = (): void => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null
          sweepRef.current()
        })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [scrollRef, chatId])

  // Счётчики с сервера — на всех устройствах. Для открытого чата сверяем очередь: новое
  // упоминание или прочтение на другом устройстве — перезапрашиваем, своё эхо — нет.
  useRealtimeEvent<{ chatId: string } & ChatAttentionCounts>('chat:attention', (p) => {
    qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
      old ? withAttentionCounts(old, p.chatId, p) : old,
    )
    if (p.chatId !== chatId) return
    for (const kind of KINDS) {
      const key = chatKeys.attention(p.chatId, kind)
      const queue = qc.getQueryData<ChatAttentionQueue>(key)
      if (isQueueStale(p[COUNT_KEY[kind]], queue, readRef.current[kind])) {
        void qc.invalidateQueries({ queryKey: key })
      }
    }
  })

  /**
   * Следующая цель кнопки — самое раннее непрочитанное. Сразу отмечается прочитанным:
   * человек к нему уже едет (Telegram делает так же для реакций). Очереди нет или она
   * исчерпана, а сервер насчитал больше — дозапрашиваем.
   */
  const next = useCallback(
    async (kind: ChatAttentionKind): Promise<string | null> => {
      if (!chatId) return null
      const key = chatKeys.attention(chatId, kind)
      let ids = pendingTargets(qc.getQueryData<ChatAttentionQueue>(key), readRef.current[kind])
      if (ids.length === 0) {
        const fresh = await qc.fetchQuery({
          queryKey: key,
          queryFn: () => fetchChatAttention(chatId, kind),
          staleTime: 0,
        })
        ids = pendingTargets(fresh, readRef.current[kind])
      }
      const id = ids[0] ?? null
      if (id) markRead(kind, [id])
      return id
    },
    [chatId, qc, markRead],
  )

  const readAll = useCallback(
    (kind: ChatAttentionKind): void => {
      if (!chatId) return
      const key = chatKeys.attention(chatId, kind)
      const queue = qc.getQueryData<ChatAttentionQueue>(key)
      if (queue) {
        setRead((prev) => ({
          ...prev,
          [kind]: new Set([...prev[kind], ...queue.items.map((i) => i.messageId)]),
        }))
      }
      qc.setQueryData<ChatListItem[]>(chatKeys.list(), (old) =>
        old ? withAttentionRead(old, chatId, COUNT_KEY[kind], 'all') : old,
      )
      readChatAttentionRequest(chatId, kind).catch(() => {
        void qc.invalidateQueries({ queryKey: chatKeys.list() })
        void qc.invalidateQueries({ queryKey: key })
      })
    },
    [chatId, qc],
  )

  return {
    mentionCount,
    reactionCount,
    nextMention: useCallback(() => next('mentions'), [next]),
    nextReaction: useCallback(() => next('reactions'), [next]),
    readAllMentions: useCallback(() => readAll('mentions'), [readAll]),
    readAllReactions: useCallback(() => readAll('reactions'), [readAll]),
  }
}
