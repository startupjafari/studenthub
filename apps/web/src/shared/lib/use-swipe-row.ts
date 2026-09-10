'use client'

import { useRef, useState, type RefObject, type TouchEvent as ReactTouchEvent } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from './spring'
import { hapticTick } from './haptics'

// Свайп-действия на строке списка (iOS/Telegram-стиль, двунаправленный): вправо открывается
// левая панель, влево — правая. Во время жеста узел двигается напрямую, без ре-рендера ради
// плавности; на отпускании — пружина (DESIGN_SYSTEM §7.1: прерываемость, старт от экранного
// значения, передача скорости, решение по проекции, резиновые границы, reduced-motion).
//
// Один хук на список: одновременно открыта и движется ровно одна строка — держать пружину на
// каждую значило бы сотню rAF-циклов ради одного жеста.

export type SwipeSide = 'left' | 'right'

export type SwipeRowsController = {
  /** Открытая свайпом строка и сторона её панели. */
  swiped: { id: string; side: SwipeSide } | null
  /** Жест только что двигал строку — клик по ней гасим (иначе свайп открывает элемент). */
  swipedFlagRef: RefObject<boolean>
  /** Реестр узлов строк по id: нужен, чтобы императивно доводить и закрывать соседние. */
  rowElsRef: RefObject<Map<string, HTMLElement>>
  onRowTouchStart: (e: ReactTouchEvent<HTMLElement>, id: string) => void
  onRowTouchMove: (e: ReactTouchEvent<HTMLElement>) => void
  onRowTouchEnd: (e: ReactTouchEvent<HTMLElement>, id: string) => void
  /** Программно закрыть строку (после действия по кнопке панели или при уходе фокуса). */
  closeRow: (id: string | null) => void
}

export function useSwipeRows({
  leftWidth,
  rightWidth,
  threshold = 56,
}: {
  /** Полная ширина левой панели действий (0 — свайп вправо запрещён). */
  leftWidth: number
  /** Полная ширина правой панели действий (0 — свайп влево запрещён). */
  rightWidth: number
  /** Порог проекции, после которого панель фиксируется открытой. */
  threshold?: number
}): SwipeRowsController {
  const [swiped, setSwiped] = useState<{ id: string; side: SwipeSide } | null>(null)
  const gesture = useRef<{
    id: string
    startX: number
    startY: number
    moved: boolean
    el: HTMLElement
    base: number
    // Окно последних точек — по нему считается скорость отпускания.
    history: { position: number; time: number }[]
  } | null>(null)
  // Строка, которую сейчас доводит пружина: одновременно движется ровно одна.
  const rowSpring = useRef<{ el: HTMLElement; spring: SpringHandle } | null>(null)
  const swipedFlagRef = useRef(false)
  const rowElsRef = useRef<Map<string, HTMLElement>>(new Map())

  /** Смещение строки по её логическому состоянию (право = +, лево = −). */
  function rowOffset(id: string): number {
    if (swiped?.id !== id) return 0
    return swiped.side === 'left' ? leftWidth : -rightWidth
  }

  function paintRow(el: HTMLElement, x: number): void {
    el.style.transform = x ? `translateX(${x}px)` : ''
  }

  /**
   * Поставить строку в положение `x`. `velocity` (px/с) — скорость пальца в момент
   * отпускания: пружина стартует с ней, поэтому между жестом и доводкой нет шва.
   * Без скорости — мгновенно (перехват пальцем, программное закрытие соседней строки).
   */
  function setRowTransform(el: HTMLElement | null, x: number, velocity?: number): void {
    if (!el) return
    rowSpring.current?.spring.stop()
    el.style.transition = 'none'
    if (velocity === undefined || prefersReducedMotion()) {
      rowSpring.current = null
      paintRow(el, x)
      return
    }
    const from = currentRowX(el)
    const spring = createSpring({
      from,
      // Строка «доброшена» пальцем — лёгкий перелёт здесь уместен.
      damping: 0.8,
      response: 0.3,
      onChange: (v) => paintRow(el, v),
      onRest: () => {
        rowSpring.current = null
      },
    })
    rowSpring.current = { el, spring }
    spring.to(x, velocity)
  }

  /** Текущее экранное смещение строки — точка старта при перехвате. */
  function currentRowX(el: HTMLElement): number {
    if (rowSpring.current?.el === el) return rowSpring.current.spring.value
    const m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform)
    return m ? Number(m[1]) : 0
  }

  function onRowTouchStart(e: ReactTouchEvent<HTMLElement>, id: string): void {
    const tch = e.touches[0]
    if (!tch) return
    const el = e.currentTarget
    // Строку можно перехватить прямо на доводке: базой берём её ЭКРАННОЕ положение,
    // а не логическое, иначе она прыгнет под пальцем.
    const base = rowSpring.current?.el === el ? currentRowX(el) : rowOffset(id)
    rowSpring.current?.spring.stop()
    gesture.current = {
      id,
      startX: tch.clientX,
      startY: tch.clientY,
      moved: false,
      el,
      base,
      history: [{ position: tch.clientX, time: e.timeStamp }],
    }
  }

  function onRowTouchMove(e: ReactTouchEvent<HTMLElement>): void {
    const s = gesture.current
    const tch = e.touches[0]
    if (!s || !tch) return
    const dx = tch.clientX - s.startX
    const dy = tch.clientY - s.startY
    if (!s.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) s.moved = true
    if (!s.moved) return
    s.history.push({ position: tch.clientX, time: e.timeStamp })
    if (s.history.length > 8) s.history.shift()
    let x = s.base + dx
    // Резина за пределами хода панелей: формула асимптотически замирает — дальше некуда,
    // но элемент продолжает откликаться, а жёсткий стоп читался бы как «заело».
    const span = s.el.offsetWidth || 1
    if (x > leftWidth) x = leftWidth + rubberband(x - leftWidth, span)
    else if (x < -rightWidth) x = -rightWidth - rubberband(-rightWidth - x, span)
    setRowTransform(s.el, x)
  }

  function closeRow(id: string | null): void {
    if (id) setRowTransform(rowElsRef.current.get(id) ?? null, 0, 0)
    setSwiped((cur) => (cur?.id === id ? null : cur))
  }

  function onRowTouchEnd(e: ReactTouchEvent<HTMLElement>, id: string): void {
    const s = gesture.current
    gesture.current = null
    if (!s || !s.moved) return
    swipedFlagRef.current = true
    const dx = (e.changedTouches[0]?.clientX ?? s.startX) - s.startX
    const finalX = s.base + dx
    const velocity = velocityFrom(s.history)
    // Решаем по точке, где строка ОСТАНОВИЛАСЬ БЫ сама, а не по той, где палец отпустили:
    // иначе быстрый короткий флик не открывает панель, а медленное перетаскивание на ту же
    // дистанцию — открывает; ощущается как лотерея.
    const projected = finalX + projectMomentum(velocity)
    const closeOther = (): void => {
      if (swiped && swiped.id !== id) {
        setRowTransform(rowElsRef.current.get(swiped.id) ?? null, 0, 0)
      }
    }
    if (leftWidth > 0 && projected > threshold) {
      closeOther()
      // Тик синхронно с началом доводки, а не после неё: ощущение должно совпасть с кадром,
      // на котором строка «поймала» открытое положение.
      hapticTick()
      setRowTransform(s.el, leftWidth, velocity)
      setSwiped({ id, side: 'left' })
    } else if (rightWidth > 0 && projected < -threshold) {
      closeOther()
      hapticTick()
      setRowTransform(s.el, -rightWidth, velocity)
      setSwiped({ id, side: 'right' })
    } else {
      setRowTransform(s.el, 0, velocity)
      setSwiped((cur) => (cur?.id === id ? null : cur))
    }
  }

  return {
    swiped,
    swipedFlagRef,
    rowElsRef,
    onRowTouchStart,
    onRowTouchMove,
    onRowTouchEnd,
    closeRow,
  }
}
