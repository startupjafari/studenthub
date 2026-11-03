'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import { toStage, type Place, type Pt, type Size } from './crop-geometry'

/** Чувствительность колеса мыши. */
const WHEEL_ZOOM = 0.0015

export interface CropGesturesOptions {
  /** Сцена: на ней ловятся указатели и колесо. Рамка стоит по её центру. */
  stageRef: RefObject<HTMLElement | null>
  stage: Size | null
  place: Place
  setPlace: Dispatch<SetStateAction<Place>>
  /** Приводит положение к допустимому (масштаб и смещение). */
  normalize: (p: Place) => Place
  /** Жесты выключены, пока снимок не загружен. */
  enabled: boolean
  /** Жест начался — выключить анимацию, чтобы снимок не отставал от пальца. */
  onStart?: () => void
}

/**
 * Жесты кадрирования на сцене: один палец или мышь — сдвиг, два пальца — щипок со сдвигом,
 * колесо — зум под курсором. Общие для окна кадрирования и редактора сторис.
 */
export function useCropGestures({
  stageRef,
  stage,
  place,
  setPlace,
  normalize,
  enabled,
  onStart,
}: CropGesturesOptions) {
  const [interacting, setInteracting] = useState(false)
  // Актуальные значения для обработчиков указателя: те живут дольше одного рендера.
  const live = useRef({ place, normalize, onStart })
  live.current = { place, normalize, onStart }

  /**
   * Приблизить в `factor` раз вокруг точки сцены `anchor` (под курсором или между пальцами);
   * `to` — куда эта точка переехала (щипок ещё и сдвигает).
   */
  const zoomAround = useCallback(
    (from: Place, factor: number, anchor: Pt, to: Pt = anchor): Place => {
      if (!stage) return from
      const cx = stage.w / 2 + from.x
      const cy = stage.h / 2 + from.y
      const nx = to.x + (cx - anchor.x) * factor - stage.w / 2
      const ny = to.y + (cy - anchor.y) * factor - stage.h / 2
      return live.current.normalize({ x: nx, y: ny, s: from.s * factor })
    },
    [stage],
  )

  // Колесо — зум под курсором. Слушатель не пассивный: иначе нельзя отменить прокрутку
  // страницы под окном.
  useEffect(() => {
    const el = stageRef.current
    if (!el || !enabled) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      live.current.onStart?.()
      const at = toStage(el, e)
      setPlace((p) => zoomAround(p, Math.exp(-e.deltaY * WHEEL_ZOOM), at))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [stageRef, enabled, setPlace, zoomAround])

  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<
    | { mode: 'pan'; start: Pt; from: Place }
    | { mode: 'pinch'; dist: number; mid: Pt; from: Place }
    | null
  >(null)

  function beginGesture(): void {
    const pts = [...pointers.current.values()]
    const from = live.current.place
    if (pts.length >= 2) {
      const [a, b] = pts as [Pt, Pt]
      gesture.current = {
        mode: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        from,
      }
    } else if (pts.length === 1) {
      gesture.current = { mode: 'pan', start: pts[0] as Pt, from }
    } else {
      gesture.current = null
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>): void {
    if (!enabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, toStage(stageRef.current, e))
    live.current.onStart?.()
    setInteracting(true)
    beginGesture()
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>): void {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, toStage(stageRef.current, e))
    const g = gesture.current
    if (!g) return
    if (g.mode === 'pan') {
      const p = pointers.current.get(e.pointerId) as Pt
      setPlace(
        live.current.normalize({
          x: g.from.x + p.x - g.start.x,
          y: g.from.y + p.y - g.start.y,
          s: g.from.s,
        }),
      )
    } else {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      setPlace(zoomAround(g.from, dist / g.dist, g.mid, mid))
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>): void {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (!pointers.current.delete(e.pointerId)) return
    // Убрали один палец из двух — продолжаем сдвиг оставшимся, без рывка.
    beginGesture()
    if (pointers.current.size === 0) setInteracting(false)
  }

  return {
    interacting,
    setInteracting,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}
