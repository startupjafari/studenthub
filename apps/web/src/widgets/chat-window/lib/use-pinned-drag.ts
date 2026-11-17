'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from '../../../shared/lib/spring'
import { hapticTick } from '../../../shared/lib'
import { dropIndex, dropOffset, moveItem, shiftFor } from './pinned-order'

/** Столько пикселей указатель должен пройти, чтобы нажатие стало перетаскиванием. */
const MOUSE_SLOP = 5
/** После долгого нажатия палец сдвигается на столько — меню закрывается, строка едет. */
const TOUCH_SLOP = 10

/** Пружины перестановки: соседи уступают место спокойно, отпущенная строка — с инерцией. */
const NEIGHBOR_SPRING = { damping: 1, response: 0.28 }
const DROP_SPRING = { damping: 0.85, response: 0.3 }
/** Сколько ждать, пока новый порядок дойдёт до списка (оптимистичный кэш — доли секунды). */
const COMMIT_GRACE_MS = 1500

interface Drag {
  id: string
  from: number
  target: number
  ids: string[]
  rows: { top: number; height: number }[]
  startY: number
  offset: number
  history: { position: number; time: number }[]
}

/**
 * Перетаскивание закреплённых чатов в списке — как в Telegram: мышью сразу, пальцем после
 * долгого нажатия (оно открывает меню строки; повёл пальцем — меню закрылось, строка едет).
 *
 * Строка следует за указателем напрямую (без ре-рендера), соседи уступают место пружинами,
 * отпущенная строка доезжает на место пружиной со скоростью броска (DESIGN_SYSTEM §7.1). За
 * пределами закреплённых — резина: дальше места нет, но строка откликается. Только когда
 * она встала, уходит новый порядок (`onCommit`) — список перерисовывается в нём без
 * анимации перестановки (`skipReorderRef` для useListReorder), а трансформы снимаются в том
 * же кадре: шва нет.
 *
 * Esc во время перетаскивания отменяет его. Клавиатурная альтернатива — `moveBy` (меню
 * строки и Alt+Shift+↑/↓ в списке).
 */
export function usePinnedDrag({
  pinnedIds,
  enabled,
  onCommit,
  onTouchDragStart,
}: {
  /** Видимые закреплённые в нынешнем порядке — они идут первыми строками списка. */
  pinnedIds: readonly string[]
  /** Переставлять можно (список «Все» или архив, не поиск, закреплённых больше одного). */
  enabled: boolean
  /** Новый порядок видимых закреплённых. */
  onCommit: (order: string[]) => void
  /** Палец повёл строку после долгого нажатия — закрыть меню строки. */
  onTouchDragStart?: () => void
}) {
  const elsRef = useRef(new Map<string, HTMLElement>())
  const dragRef = useRef<Drag | null>(null)
  const springsRef = useRef(new Map<string, SpringHandle>())
  const pendingRef = useRef<{ id: string; startY: number; pointerId: number } | null>(null)
  const committedRef = useRef(false)
  const suppressClickRef = useRef(false)
  /** Для useListReorder: следующую перестановку уже показали руками. */
  const skipReorderRef = useRef(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Свежие значения для слушателей окна: подписка одна на жест.
  const live = useRef({ pinnedIds, enabled, onCommit, onTouchDragStart })
  live.current = { pinnedIds, enabled, onCommit, onTouchDragStart }

  const register = useCallback(
    (id: string) =>
      (el: HTMLElement | null): void => {
        if (el) elsRef.current.set(id, el)
        else elsRef.current.delete(id)
      },
    [],
  )

  const paint = (id: string, y: number): void => {
    const el = elsRef.current.get(id)
    if (el) el.style.transform = y ? `translateY(${y}px)` : ''
  }

  /** Довести строку пружиной (или сразу, если просили меньше движения). */
  const springTo = (
    id: string,
    to: number,
    tuning: { damping: number; response: number },
    velocity?: number,
    onRest?: () => void,
  ): void => {
    const current = springsRef.current.get(id)
    if (prefersReducedMotion()) {
      current?.stop()
      springsRef.current.delete(id)
      paint(id, to)
      onRest?.()
      return
    }
    const spring =
      current ??
      createSpring({
        from: currentY(id),
        ...tuning,
        onChange: (v) => paint(id, v),
      })
    spring.configure(tuning)
    springsRef.current.set(id, spring)
    if (onRest) {
      // Пружина зовёт onRest из опций; здесь он свой на каждую доводку — оборачиваем.
      const handle = spring
      const check = (): void => {
        if (!handle.animating) {
          onRest()
          return
        }
        requestAnimationFrame(check)
      }
      handle.to(to, velocity)
      requestAnimationFrame(check)
      return
    }
    spring.to(to, velocity)
  }

  const currentY = (id: string): number => {
    const spring = springsRef.current.get(id)
    if (spring) return spring.value
    const m = /translateY\((-?[\d.]+)px\)/.exec(elsRef.current.get(id)?.style.transform ?? '')
    return m ? Number(m[1]) : 0
  }

  /** Снять все следы жеста со строк (трансформы, слой, пружины). */
  const clearRows = (): void => {
    for (const spring of springsRef.current.values()) spring.stop()
    springsRef.current.clear()
    for (const el of elsRef.current.values()) {
      el.style.transform = ''
      el.style.transition = ''
      el.style.zIndex = ''
      el.classList.remove('shadow-lg')
    }
  }

  const begin = (id: string, startY: number): boolean => {
    const ids = [...live.current.pinnedIds]
    const from = ids.indexOf(id)
    if (from < 0 || ids.length < 2) return false
    const rows = ids.map((pid) => {
      const el = elsRef.current.get(pid)
      return { top: el?.offsetTop ?? 0, height: el?.offsetHeight ?? 0 }
    })
    dragRef.current = {
      id,
      from,
      target: from,
      ids,
      rows,
      startY,
      offset: 0,
      history: [{ position: startY, time: performance.now() }],
    }
    for (const pid of ids) {
      const el = elsRef.current.get(pid)
      if (el) el.style.transition = 'none'
    }
    const el = elsRef.current.get(id)
    if (el) {
      el.style.zIndex = '20'
      el.classList.add('shadow-lg')
    }
    springsRef.current.get(id)?.stop()
    springsRef.current.delete(id)
    document.body.style.userSelect = 'none'
    hapticTick()
    setDraggingId(id)
    return true
  }

  const move = (y: number): void => {
    const d = dragRef.current
    if (!d) return
    d.history.push({ position: y, time: performance.now() })
    if (d.history.length > 8) d.history.shift()
    const first = d.rows[0]
    const last = d.rows[d.rows.length - 1]
    const self = d.rows[d.from]
    if (!first || !last || !self) return
    // Ход — от первого до последнего закреплённого места; дальше — резина.
    const min = first.top - self.top
    const max = last.top + last.height - (self.top + self.height)
    let offset = y - d.startY
    if (offset < min) offset = min - rubberband(min - offset, self.height)
    else if (offset > max) offset = max + rubberband(offset - max, self.height)
    d.offset = offset
    paint(d.id, offset)
    const target = dropIndex(d.rows, d.from, self.top + offset + self.height / 2)
    if (target === d.target) return
    d.target = target
    d.ids.forEach((pid, i) => {
      if (i === d.from) return
      springTo(pid, shiftFor(i, d.from, target, self.height), NEIGHBOR_SPRING)
    })
  }

  const finish = (cancel: boolean): void => {
    const d = dragRef.current
    dragRef.current = null
    document.body.style.userSelect = ''
    if (!d) return
    const target = cancel ? d.from : d.target
    const velocity = velocityFrom(d.history)
    if (cancel) {
      d.ids.forEach((pid, i) => {
        if (i !== d.from) springTo(pid, 0, NEIGHBOR_SPRING)
      })
    }
    springTo(d.id, dropOffset(d.rows, d.from, target), DROP_SPRING, velocity, () => {
      if (target === d.from) {
        clearRows()
        setDraggingId(null)
        return
      }
      // Строки уже стоят на новых местах: перестановку списка не анимируем, а трансформы
      // снимаем в том же кадре, в котором список перерисуется в новом порядке.
      skipReorderRef.current = true
      committedRef.current = true
      live.current.onCommit(moveItem(d.ids, d.from, target))
      // Страховка: новый порядок так и не пришёл в список — не оставлять строки сдвинутыми.
      window.setTimeout(() => {
        if (!committedRef.current) return
        committedRef.current = false
        skipReorderRef.current = false
        clearRows()
        setDraggingId(null)
      }, COMMIT_GRACE_MS)
    })
    hapticTick()
  }

  // Новый порядок пришёл в список (оптимистичный кэш) — снимаем трансформы до отрисовки.
  const sig = pinnedIds.join('|')
  useLayoutEffect(() => {
    if (!committedRef.current) return
    committedRef.current = false
    clearRows()
    setDraggingId(null)
    // clearRows читает только ref'ы; эффект нужен ровно на смену порядка.
  }, [sig])

  // ── Мышь: нажатие на закреплённой строке, перетаскивание после MOUSE_SLOP ──────────
  const onPointerDown = (e: React.PointerEvent<HTMLElement>): void => {
    if (!live.current.enabled || e.pointerType !== 'mouse' || e.button !== 0) return
    if (dragRef.current || committedRef.current) return
    const target = e.target as Node
    const id = live.current.pinnedIds.find((pid) => elsRef.current.get(pid)?.contains(target))
    if (!id) return
    pendingRef.current = { id, startY: e.clientY, pointerId: e.pointerId }
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pendingRef.current?.pointerId && !dragRef.current) return
      const pending = pendingRef.current
      if (pending && !dragRef.current) {
        if (Math.abs(ev.clientY - pending.startY) < MOUSE_SLOP) return
        pendingRef.current = null
        if (!begin(pending.id, pending.startY)) {
          stop()
          return
        }
      }
      ev.preventDefault()
      move(ev.clientY)
    }
    const onUp = (): void => {
      pendingRef.current = null
      stop()
      if (dragRef.current) {
        // Клик, который браузер пошлёт после отпускания, — не открытие чата.
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        finish(false)
      }
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || !dragRef.current) return
      ev.preventDefault()
      ev.stopPropagation()
      pendingRef.current = null
      stop()
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      finish(true)
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey, true)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey, true)
  }

  // ── Палец: после долгого нажатия (меню уже открыто) ────────────────────────────────
  const touchCleanupRef = useRef<(() => void) | null>(null)
  const armTouch = (id: string, startY: number): void => {
    if (!live.current.enabled || !live.current.pinnedIds.includes(id)) return
    if (dragRef.current || committedRef.current) return
    touchCleanupRef.current?.()
    let started = false
    const onMove = (ev: TouchEvent): void => {
      const tch = ev.touches[0]
      if (!tch) return
      if (!started) {
        if (Math.abs(tch.clientY - startY) < TOUCH_SLOP) return
        started = begin(id, startY)
        if (!started) {
          cleanup()
          return
        }
        live.current.onTouchDragStart?.()
      }
      // Иначе браузер прокрутит список вместе со строкой.
      if (ev.cancelable) ev.preventDefault()
      move(tch.clientY)
    }
    const onEnd = (ev: TouchEvent): void => {
      cleanup()
      if (started) finish(ev.type === 'touchcancel')
    }
    const cleanup = (): void => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
      touchCleanupRef.current = null
    }
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    touchCleanupRef.current = cleanup
  }

  useEffect(
    () => () => {
      touchCleanupRef.current?.()
      for (const spring of springsRef.current.values()) spring.stop()
      document.body.style.userSelect = ''
    },
    [],
  )

  /**
   * Клавиатурная альтернатива: сдвинуть закреплённый чат на шаг вверх (−1) или вниз (+1).
   * Перестановку показывает обычная анимация списка. Возвращает новую позицию (с 1) или
   * null, если двигать некуда.
   */
  const moveBy = (id: string, step: -1 | 1): number | null => {
    const ids = [...live.current.pinnedIds]
    const from = ids.indexOf(id)
    const to = from + step
    if (!live.current.enabled || from < 0 || to < 0 || to >= ids.length) return null
    live.current.onCommit(moveItem(ids, from, to))
    return to + 1
  }

  return {
    register,
    onPointerDown,
    armTouch,
    moveBy,
    draggingId,
    skipReorderRef,
    /** Клик после перетаскивания мышью — не открытие чата. */
    consumeClick: (): boolean => suppressClickRef.current,
  }
}
