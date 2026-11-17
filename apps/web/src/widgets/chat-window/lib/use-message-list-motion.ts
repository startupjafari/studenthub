'use client'

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ChatMessage } from '../../../entities/chat'
import { createSpring, prefersReducedMotion } from '../../../shared/lib'

/** На сколько ниже своего места новое сообщение начинает въезд (и не больше своей высоты). */
const APPEAR_FROM_PX = 28
/** Пачка больше этого — догон после обрыва связи или подгрузка вниз, а не «пришло сообщение». */
const APPEAR_MAX_BATCH = 2
/** Прилипшая дата гаснет, когда ленту перестали крутить (Telegram — секунда). */
const STICKY_DATE_IDLE_MS = 1000

/**
 * Новое сообщение въезжает снизу на пружине (Telegram). Только настоящее появление в хвосте:
 * открытие чата, догрузка истории вверх, догон пачкой и замена своего временного пузыря на
 * серверный (тот уже на экране) — без анимации. Двигаем `transform` и `opacity` строки, а не
 * высоту: соседи не дёргаются, а virtua мерит строку по её настоящему размеру.
 */
export function useNewMessageAppear(
  scrollRef: RefObject<HTMLDivElement | null>,
  chatId: string | null,
  messages: readonly ChatMessage[] | undefined,
): void {
  const seen = useRef<{ chatId: string | null; ids: Set<string>; lastId: string | null }>({
    chatId: null,
    ids: new Set(),
    lastId: null,
  })

  useLayoutEffect(() => {
    const prev = seen.current
    const list = messages ?? []
    const ids = new Set(list.map((m) => m.id))
    const lastId = list[list.length - 1]?.id ?? null
    seen.current = { chatId, ids, lastId }
    if (prev.chatId !== chatId || !prev.lastId || lastId === prev.lastId || !lastId) return
    // Прошлый хвост должен остаться на месте, а новых в конце — одно-два.
    const prevTailAt = list.findIndex((m) => m.id === prev.lastId)
    if (prevTailAt < 0 || list.length - 1 - prevTailAt > APPEAR_MAX_BATCH) return
    const fresh = list.slice(prevTailAt + 1).filter((m) => !prev.ids.has(m.id))
    if (fresh.length === 0 || prefersReducedMotion()) return

    // virtua монтирует новую строку в своём кадре — ищем её в следующем.
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current
      for (const m of fresh) {
        const row = document.getElementById(`msg-${m.id}`)
        if (!row || !scroller?.contains(row)) continue
        const from = Math.min(APPEAR_FROM_PX, row.offsetHeight || APPEAR_FROM_PX)
        row.style.willChange = 'transform, opacity'
        const spring = createSpring({
          from,
          damping: 0.8,
          response: 0.35,
          onChange: (v) => {
            row.style.transform = `translateY(${v}px)`
            row.style.opacity = String(Math.min(1, Math.max(0, 1 - v / from)))
          },
          onRest: () => {
            row.style.transform = ''
            row.style.opacity = ''
            row.style.willChange = ''
          },
        })
        spring.to(0)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [messages, chatId, scrollRef])
}

/**
 * Крутят ли ленту прямо сейчас. Прилипшая дата видна, пока ленту листают, и гаснет через
 * секунду покоя — иначе она висит поверх первого сообщения и закрывает его.
 */
export function useListScrolling(
  scrollRef: RefObject<HTMLDivElement | null>,
  chatId: string | null,
) {
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    setScrolling(false)
    if (!el) return
    let timer: number | null = null
    // Считаем только прокрутку человеком. Лента сама прыгает при открытии чата (к первому
    // непрочитанному, вниз) и держит низ, когда догружаются снимки, — на каждый такой прыжок
    // дата вспыхивала бы на секунду без всякой причины.
    let userAt = -Infinity
    const markUser = (): void => {
      userAt = performance.now()
    }
    const onScroll = (): void => {
      if (performance.now() - userAt > STICKY_DATE_IDLE_MS) return
      userAt = performance.now()
      setScrolling(true)
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => setScrolling(false), STICKY_DATE_IDLE_MS)
    }
    const intents = ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const
    for (const type of intents) el.addEventListener(type, markUser, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      for (const type of intents) el.removeEventListener(type, markUser)
      el.removeEventListener('scroll', onScroll)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [scrollRef, chatId])
  return scrolling
}
