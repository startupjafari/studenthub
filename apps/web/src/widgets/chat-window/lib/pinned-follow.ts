'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { MessageWindowHandle } from './message-window'

/**
 * Номер закрепа в полосе следует за прокруткой ленты, как в Telegram: показывается
 * закреплённое, ближайшее СВЕРХУ к видимой области — то, до которого человек ещё не
 * долистал. Если выше видимой области закреплённых нет — самое новое.
 *
 * Чистая функция, чтобы правило проверялось тестом без DOM.
 *
 * @param pinned закреплённые в порядке полосы (как их отдаёт сервер)
 * @param topVisibleAt время верхнего видимого сообщения ленты
 * @returns индекс в `pinned`
 */
export function pinnedIndexForViewport(
  pinned: readonly { createdAt: string }[],
  topVisibleAt: string,
): number {
  if (pinned.length === 0) return 0
  const top = new Date(topVisibleAt).getTime()
  let best = -1
  let bestAt = -Infinity
  let newest = 0
  let newestAt = -Infinity
  pinned.forEach((p, i) => {
    const at = new Date(p.createdAt).getTime()
    if (at > newestAt) {
      newestAt = at
      newest = i
    }
    if (at < top && at > bestAt) {
      bestAt = at
      best = i
    }
  })
  return best >= 0 ? best : newest
}

/** Тишина прокрутки, после которой прыжок по нажатию на полосу считается законченным. */
const SETTLE_MS = 160

export interface PinnedViewport {
  /** Прокручиваемый контейнер ленты. */
  scrollRef: RefObject<HTMLElement | null>
  /** Окно ленты (ui/message-window): по нему находится верхнее видимое сообщение. */
  virtualizerRef: RefObject<MessageWindowHandle | null>
  /** Сообщения ленты в порядке показа. */
  messages: readonly { createdAt: string }[] | undefined
}

/**
 * Подписка полосы закрепов на прокрутку ленты. Лента об этом не знает: слушатель вешается
 * на её контейнер, верхнее видимое сообщение находит окно ленты (`findItemIndex`),
 * а частота ограничена кадром.
 *
 * `onTop` зовётся со временем верхнего видимого сообщения после каждой прокрутки. Пока
 * лента едет к сообщению по нажатию на полосу (`hold()`), колбэк молчит: полоса уже
 * показала следующее закрепление, и промежуточные кадры прыжка не должны его перебить —
 * так же, как в Telegram, где номер ждёт конца перехода.
 */
export function usePinnedViewportFollow(
  viewport: PinnedViewport | undefined,
  onTop: (topVisibleAt: string) => void,
): { hold: () => void } {
  const onTopRef = useRef(onTop)
  onTopRef.current = onTop
  const messagesRef = useRef(viewport?.messages)
  messagesRef.current = viewport?.messages
  const holdRef = useRef(false)
  const settleRef = useRef<number | null>(null)

  const scrollRef = viewport?.scrollRef
  const virtualizerRef = viewport?.virtualizerRef
  useEffect(() => {
    const el = scrollRef?.current
    if (!el || !virtualizerRef) return
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      if (holdRef.current) return
      const vh = virtualizerRef.current
      const data = messagesRef.current
      if (!vh || !data || data.length === 0) return
      const idx = Math.min(Math.max(vh.findItemIndex(vh.scrollOffset), 0), data.length - 1)
      const top = data[idx]
      if (top) onTopRef.current(top.createdAt)
    }
    const onScroll = (): void => {
      if (holdRef.current) {
        // Прыжок ещё едет: ждём тишины, и только после неё снова следим за прокруткой.
        if (settleRef.current !== null) window.clearTimeout(settleRef.current)
        settleRef.current = window.setTimeout(() => {
          settleRef.current = null
          holdRef.current = false
        }, SETTLE_MS)
        return
      }
      if (frame === null) frame = requestAnimationFrame(measure)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame !== null) cancelAnimationFrame(frame)
      if (settleRef.current !== null) window.clearTimeout(settleRef.current)
    }
  }, [scrollRef, virtualizerRef])

  return {
    hold: () => {
      holdRef.current = true
      // Прыжка может и не быть (сообщение уже на экране) — тогда прокрутки не придёт, и
      // слежение возвращается само.
      if (settleRef.current !== null) window.clearTimeout(settleRef.current)
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null
        holdRef.current = false
      }, SETTLE_MS * 4)
    },
  }
}
