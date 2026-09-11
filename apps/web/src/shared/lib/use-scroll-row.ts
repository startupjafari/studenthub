'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  velocityFrom,
  type SpringHandle,
} from './spring'

// Горизонтальный ряд, который может не влезть: табы, чипы-фильтры, миниатюры, тулбар.
//
// Что берёт на себя хук:
//  1. Тянуть ряд мышью — на десктопе полосы прокрутки у таких рядов нет (она перекрывала бы
//     кромку содержимого), а колесо крутит страницу, поэтому без перетаскивания дальние
//     пункты недостижимы. На отпускании — инерция пружиной (DESIGN_SYSTEM §7.1: старт от
//     экранного значения, скорость жеста передаётся в анимацию, решение по проекции).
//  2. Знать, что ряд правда прокручивается и у какого края стоит, — из этого собирается
//     маска затухания: «есть ещё» видно, а не угадывается.
//  3. Довести нужный элемент до видимой зоны (`reveal`) — активный таб не остаётся за обрезом.
//
// На тач-экране жест НЕ перехватывается: нативная инерционная прокрутка прерываема, знает
// свои края, различает горизонтальный и вертикальный пан (палец из ряда может тянуть
// страницу) и уважает системные настройки. Своя реализация была бы строго хуже.

/** Ниже этого смещения жест — клик, а не перетаскивание. */
const DRAG_SLOP = 4
/** Ширина затухания у края, px. */
const FADE = 24
/** Запас при доводке элемента в видимую зону: он не должен липнуть к обрезу. */
const REVEAL_PAD = 16
/** Окно точек для расчёта скорости отпускания. */
const HISTORY = 10

export interface ScrollRowController<T extends HTMLElement> {
  /**
   * Ref самой дорожки. Callback, а не объект: ряд может появиться позже своего родителя
   * (папки чатов приходят вместе с чатами), и разовая привязка к `ref.current` не
   * дождалась бы узла.
   */
  ref: (node: T | null) => void
  /** Содержимое шире дорожки — ряд действительно прокручивается. */
  overflowing: boolean
  atStart: boolean
  atEnd: boolean
  /** Мышь тянет ряд прямо сейчас: курсор «схвачено», текст не выделяется. */
  dragging: boolean
  /** Довести элемент ряда до видимой зоны. */
  reveal: (child: HTMLElement | null) => void
  /** Маска затухания у краёв для `mask-image`; `undefined`, когда ряд влезает целиком. */
  fadeMask: string | undefined
}

export function useScrollRow<T extends HTMLElement = HTMLDivElement>(): ScrollRowController<T> {
  const [node, setNode] = useState<T | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)
  const [dragging, setDragging] = useState(false)
  const springRef = useRef<SpringHandle | null>(null)
  // Ряд только что тянули: родившийся из броска клик гасим, иначе бросок попадает в таб.
  const draggedRef = useRef(false)

  const ref = useCallback((next: T | null): void => {
    setNode(next)
  }, [])

  const measure = useCallback((): void => {
    if (!node) return
    const max = node.scrollWidth - node.clientWidth
    setOverflowing(max > 1)
    setAtStart(node.scrollLeft <= 1)
    setAtEnd(node.scrollLeft >= max - 1)
  }, [node])

  // После каждого рендера: содержимое ряда меняется без изменения его размеров (пришли
  // счётчики, добавился фильтр), а ResizeObserver такого не видит.
  useEffect(() => {
    measure()
  })

  useEffect(() => {
    if (!node) return
    // ResizeObserver есть не везде (jsdom в тестах): без него остаётся пересчёт на скролле
    // и после рендера — ряд не сломается, просто не заметит смену размеров контейнера.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    node.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer?.disconnect()
      node.removeEventListener('scroll', measure)
    }
  }, [node, measure])

  /** Пружинная доводка `scrollLeft`. `velocity` — скорость прокрутки, px/с. */
  const glide = useCallback((el: T, target: number, velocity?: number): void => {
    springRef.current?.stop()
    if (Math.abs(target - el.scrollLeft) < 1 && !velocity) return
    if (prefersReducedMotion()) {
      el.scrollLeft = target
      return
    }
    const spring = createSpring({
      from: el.scrollLeft,
      // Без перелёта: ряд, отскакивающий от края назад, читается как сбой прокрутки,
      // а не как живость.
      damping: 1,
      response: 0.4,
      onChange: (value) => {
        el.scrollLeft = value
      },
    })
    springRef.current = spring
    spring.to(target, velocity)
  }, [])

  useEffect(() => {
    if (!node) return

    let startX = 0
    let base = 0
    let active = false
    let moved = false
    let history: { position: number; time: number }[] = []

    const maxScroll = (): number => node.scrollWidth - node.clientWidth

    function onPointerDown(e: PointerEvent): void {
      // Только мышь и только левой кнопкой: тач отдан нативной прокрутке, перо и правая
      // кнопка — системным жестам.
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (maxScroll() < 1) return
      springRef.current?.stop()
      // Флаг гасим здесь, а не только в обработчике клика: если мышь отпустили вне ряда,
      // клика по нему не будет — и взведённый флаг съел бы следующее нажатие.
      draggedRef.current = false
      active = true
      moved = false
      startX = e.clientX
      base = node.scrollLeft
      history = [{ position: e.clientX, time: performance.now() }]
    }

    function onPointerMove(e: PointerEvent): void {
      if (!active) return
      const dx = e.clientX - startX
      if (!moved) {
        if (Math.abs(dx) < DRAG_SLOP) return
        moved = true
        draggedRef.current = true
        setDragging(true)
      }
      node.scrollLeft = base - dx
      history.push({ position: e.clientX, time: performance.now() })
      if (history.length > HISTORY) history.shift()
      // Перетаскивание ряда — не выделение текста в подписях.
      e.preventDefault()
    }

    function onPointerUp(): void {
      if (!active) return
      active = false
      if (!moved) return
      setDragging(false)
      // Скорость мыши направлена противоположно прокрутке: ведём вправо — scrollLeft падает.
      const scrollVelocity = -velocityFrom(history)
      const target = Math.max(
        0,
        Math.min(node.scrollLeft + projectMomentum(scrollVelocity), maxScroll()),
      )
      glide(node, target, scrollVelocity)
    }

    function onClick(e: MouseEvent): void {
      if (!draggedRef.current) return
      draggedRef.current = false
      e.preventDefault()
      e.stopPropagation()
    }

    node.addEventListener('pointerdown', onPointerDown)
    // Движение и отпускание — на окне: мышь уходит за пределы ряда, а жест продолжается.
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    // Capture: гасим клик до того, как он дойдёт до кнопки внутри ряда.
    node.addEventListener('click', onClick, true)
    return () => {
      node.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      node.removeEventListener('click', onClick, true)
      springRef.current?.stop()
    }
  }, [node, glide])

  const reveal = useCallback(
    (child: HTMLElement | null): void => {
      if (!node || !child) return
      const max = node.scrollWidth - node.clientWidth
      if (max < 1) return
      // Через прямоугольники, а не offsetLeft: ряд не обязан быть offsetParent элемента.
      const row = node.getBoundingClientRect()
      const box = child.getBoundingClientRect()
      const overLeft = box.left - row.left - REVEAL_PAD
      const overRight = box.right - row.right + REVEAL_PAD
      let target = node.scrollLeft
      if (overLeft < 0) target = node.scrollLeft + overLeft
      else if (overRight > 0) target = node.scrollLeft + overRight
      glide(node, Math.max(0, Math.min(target, max)))
    },
    [node, glide],
  )

  const fadeMask = overflowing
    ? `linear-gradient(to right, transparent 0, black ${atStart ? 0 : FADE}px, black calc(100% - ${
        atEnd ? 0 : FADE
      }px), transparent 100%)`
    : undefined

  return { ref, overflowing, atStart, atEnd, dragging, reveal, fadeMask }
}
