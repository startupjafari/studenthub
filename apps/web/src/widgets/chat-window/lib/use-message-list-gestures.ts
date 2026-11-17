'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { ChatMessage } from '../../../entities/chat'

// Жесты мышью и пальцем по ленте целиком (а не по пузырю): двойной клик/двойное касание —
// реакция по умолчанию, протягивание мышью — выделение нескольких сообщений, Shift+клик в
// режиме выбора — диапазон. Обработчики делегированы контейнеру прокрутки: строки ленты
// виртуализированы (virtua) и монтируются по мере прокрутки, а слушатель один.

/** Двойное касание: второй тап не позже и не дальше этого от первого. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 24
/** Протягивание начинается после сдвига указателя на столько — короткий дрожащий клик не в счёт. */
const DRAG_START_PX = 6
/** Полоса у верхнего и нижнего края, где протягивание само прокручивает ленту. */
const EDGE_PX = 48
const EDGE_MAX_SPEED_PX = 18

/** То, на чём двойной клик и протягивание принадлежат самому элементу: текст, ссылки, медиа. */
const OWN_GESTURE =
  'a,button,input,textarea,select,label,video,audio,img,canvas,[role="button"],[role="slider"],[contenteditable="true"],.select-text'

const ROW_PREFIX = 'msg-'

function rowOf(target: EventTarget | null, scroller: HTMLElement | null): HTMLElement | null {
  if (!(target instanceof Element) || !scroller) return null
  const row = target.closest<HTMLElement>(`[id^="${ROW_PREFIX}"]`)
  return row && scroller.contains(row) ? row : null
}

const idOf = (row: HTMLElement): string => row.id.slice(ROW_PREFIX.length)

/**
 * Оверлей выбора в режиме выделения — кнопка во всю строку, прямой ребёнок строки
 * (message-item). Протягивание с неё — основной способ выделить пачку, его не глушим.
 */
function isSelectOverlay(el: Element, row: HTMLElement): boolean {
  return el.tagName === 'BUTTON' && el.parentElement === row
}

/** Сообщение, которое можно выбрать и на которое можно реагировать. */
const selectable = (m: ChatMessage | undefined): m is ChatMessage =>
  !!m && !m.systemType && !m.id.startsWith('tmp:')

export interface MessageListGesturesOptions {
  scrollRef: RefObject<HTMLDivElement | null>
  messages: readonly ChatMessage[] | undefined
  selecting: boolean
  selectedIds: ReadonlySet<string>
  /** Жесты выключены: поиск по чату, запрос на переписку — там реакции и выбор неуместны. */
  disabled?: boolean
  onDefaultReaction: (messageId: string) => void
  /** Новый набор выбранных; пустой — выйти из режима выбора. */
  onSelectionChange: (ids: Set<string>) => void
}

export function useMessageListGestures(options: MessageListGesturesOptions) {
  // Обработчики живут дольше рендера (слушатели окна на время протягивания) — читают свежее.
  const opts = useRef(options)
  opts.current = options

  const lastPointer = useRef<'mouse' | 'touch' | 'pen'>('mouse')
  const lastTap = useRef<{ id: string; at: number; x: number; y: number } | null>(null)
  // Опорное сообщение для Shift+клика — последнее, по которому щёлкнули в режиме выбора.
  const rangeAnchor = useRef<string | null>(null)
  const drag = useRef<{
    anchorId: string
    startX: number
    startY: number
    lastX: number
    lastY: number
    active: boolean
    base: Set<string>
    mode: 'add' | 'remove'
    frame: number | null
    cleanup: () => void
  } | null>(null)
  const swallowClick = useRef(false)

  // Размонтирование посреди протягивания — снять слушатели окна и вернуть выделение текста.
  useEffect(() => () => drag.current?.cleanup(), [])

  const indexOf = (id: string): number => opts.current.messages?.findIndex((m) => m.id === id) ?? -1

  function rangeIds(fromId: string, toId: string): string[] {
    const list = opts.current.messages ?? []
    const a = indexOf(fromId)
    const b = indexOf(toId)
    if (a < 0 || b < 0) return []
    return list
      .slice(Math.min(a, b), Math.max(a, b) + 1)
      .filter(selectable)
      .map((m) => m.id)
  }

  function applyDrag(targetId: string): void {
    const d = drag.current
    if (!d) return
    const ids = rangeIds(d.anchorId, targetId)
    const next = new Set(d.base)
    for (const id of ids) {
      if (d.mode === 'add') next.add(id)
      else next.delete(id)
    }
    opts.current.onSelectionChange(next)
  }

  function rowAtPointer(x: number, y: number): HTMLElement | null {
    const scroller = opts.current.scrollRef.current
    if (!scroller) return null
    const box = scroller.getBoundingClientRect()
    // Указатель ушёл выше или ниже ленты — берём крайнюю видимую строку по этой стороне.
    const clampedY = Math.min(Math.max(y, box.top + 1), box.bottom - 1)
    const clampedX = Math.min(Math.max(x, box.left + 1), box.right - 1)
    return rowOf(document.elementFromPoint(clampedX, clampedY), scroller)
  }

  function trackPointer(): void {
    const d = drag.current
    if (!d?.active) return
    const row = rowAtPointer(d.lastX, d.lastY)
    if (row) applyDrag(idOf(row))
  }

  function edgeScroll(): void {
    const d = drag.current
    const scroller = opts.current.scrollRef.current
    if (!d || !scroller) return
    d.frame = null
    if (!d.active) return
    const box = scroller.getBoundingClientRect()
    const padBottom = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
    const top = box.top + EDGE_PX
    const bottom = box.bottom - padBottom - EDGE_PX
    let speed = 0
    if (d.lastY < top) speed = -Math.min(EDGE_MAX_SPEED_PX, (top - d.lastY) / 2)
    else if (d.lastY > bottom) speed = Math.min(EDGE_MAX_SPEED_PX, (d.lastY - bottom) / 2)
    if (speed === 0) return
    scroller.scrollTop += speed
    trackPointer()
    d.frame = requestAnimationFrame(edgeScroll)
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    const o = opts.current
    if (o.disabled || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return
    if (lastPointer.current === 'touch') return
    const scroller = o.scrollRef.current
    const row = rowOf(e.target, scroller)
    if (!row) return
    const own = (e.target as Element).closest(OWN_GESTURE)
    if (own && !(o.selecting && isSelectOverlay(own, row))) return
    const anchorId = idOf(row)
    if (!selectable(o.messages?.find((m) => m.id === anchorId))) return

    const onMove = (ev: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      d.lastX = ev.clientX
      d.lastY = ev.clientY
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_START_PX) return
        const over = rowAtPointer(ev.clientX, ev.clientY)
        // Вне режима выбора протягивание внутри одного сообщения — ещё не выделение:
        // так тянут мышь, промахнувшись мимо текста. В режиме выбора — уже оно.
        if (!opts.current.selecting && (!over || idOf(over) === d.anchorId)) return
        d.active = true
        window.getSelection()?.removeAllRanges()
        document.body.style.userSelect = 'none'
      }
      trackPointer()
      if (d.frame === null) d.frame = requestAnimationFrame(edgeScroll)
    }
    const onUp = (): void => {
      const d = drag.current
      if (d?.active) {
        // Клик, которым кончается протягивание, не должен переключить строку под курсором.
        swallowClick.current = true
        window.setTimeout(() => {
          swallowClick.current = false
        }, 0)
        rangeAnchor.current = d.anchorId
      }
      d?.cleanup()
    }
    const cleanup = (): void => {
      const d = drag.current
      if (d?.frame != null) cancelAnimationFrame(d.frame)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      drag.current = null
    }
    drag.current?.cleanup()
    drag.current = {
      anchorId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      base: new Set(o.selecting ? o.selectedIds : []),
      // Начали с выбранного — протягивание снимает выбор, с невыбранного — ставит (как в TG Desktop).
      mode: o.selecting && o.selectedIds.has(anchorId) ? 'remove' : 'add',
      frame: null,
      cleanup,
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>): void {
    if (swallowClick.current) {
      swallowClick.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    const o = opts.current
    if (o.disabled || !o.selecting) return
    const row = rowOf(e.target, o.scrollRef.current)
    if (!row) return
    const id = idOf(row)
    const anchor = rangeAnchor.current
    rangeAnchor.current = id
    // Shift+клик — диапазон от прошлого щелчка до этого (выбор ставится, как в Telegram).
    if (!e.shiftKey || !anchor || anchor === id) return
    e.preventDefault()
    e.stopPropagation()
    const next = new Set(o.selectedIds)
    for (const rid of rangeIds(anchor, id)) next.add(rid)
    o.onSelectionChange(next)
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    lastPointer.current =
      e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse'
  }

  function react(e: React.MouseEvent, row: HTMLElement): void {
    const id = idOf(row)
    if (!selectable(opts.current.messages?.find((m) => m.id === id))) return
    e.preventDefault()
    // Двойной клик рядом с текстом успевает выделить слово — оно здесь ни к чему.
    window.getSelection()?.removeAllRanges()
    opts.current.onDefaultReaction(id)
  }

  /** Двойной клик мышью по пузырю или строке вне текста и кнопок — реакция по умолчанию. */
  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>): void {
    const o = opts.current
    if (o.disabled || o.selecting || lastPointer.current === 'touch') return
    const row = rowOf(e.target, o.scrollRef.current)
    if (!row || (e.target as Element).closest(OWN_GESTURE)) return
    react(e, row)
  }

  /**
   * Двойное касание. Свой счёт, а не `dblclick`: мобильный Safari его на касаниях не шлёт, а
   * строка с `touch-action: pan-y` не даёт браузеру принять двойной тап за масштабирование.
   */
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const o = opts.current
    if (o.disabled || o.selecting || lastPointer.current !== 'touch') return
    const row = rowOf(e.target, o.scrollRef.current)
    if (!row || (e.target as Element).closest(OWN_GESTURE)) {
      lastTap.current = null
      return
    }
    const id = idOf(row)
    const now = performance.now()
    const prev = lastTap.current
    if (
      prev &&
      prev.id === id &&
      now - prev.at < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP_PX
    ) {
      lastTap.current = null
      react(e, row)
      return
    }
    lastTap.current = { id, at: now, x: e.clientX, y: e.clientY }
  }

  return { onMouseDown, onClickCapture, onClick, onDoubleClick, onPointerDown }
}
