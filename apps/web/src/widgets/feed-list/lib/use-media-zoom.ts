import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/** Во сколько раз приближает двойной клик и кнопка. */
export const MEDIA_ZOOM = 2.5

interface Zoom {
  s: number
  x: number
  y: number
}

const NONE: Zoom = { s: 1, x: 0, y: 0 }

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Зум снимка в полном просмотре: двойной клик приближает в точку клика, кнопка — в центр,
 * увеличенный кадр двигается перетаскиванием. Сдвиг ограничен краями снимка: за кадр
 * нельзя «уехать» в пустоту.
 *
 * Сцена (`stageRef`) — слой во всю оправу, его и трансформируем. Размер снимка берётся
 * из `offsetWidth/Height` картинки: трансформация на них не влияет, поэтому границы
 * считаются от вписанного кадра, а не от уже увеличенного.
 *
 * `resetKey` — смена кадра (карусель, другой пост) сбрасывает зум.
 */
export function useMediaZoom(resetKey: unknown) {
  const [zoom, setZoom] = useState<Zoom>(NONE)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null)

  useEffect(() => {
    setZoom(NONE)
    drag.current = null
    setDragging(false)
  }, [resetKey])

  function clamp(next: Zoom): Zoom {
    const stage = stageRef.current
    const img = stage?.querySelector('img')
    if (!stage || !img || next.s <= 1) return { ...next, x: 0, y: 0 }
    const maxX = Math.max(0, (img.offsetWidth * next.s - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * next.s - stage.clientHeight) / 2)
    return {
      s: next.s,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }

  const zoomed = zoom.s > 1
  const reset = useCallback(() => setZoom(NONE), [])

  /** Приблизить в точку (или в центр без неё); увеличенный кадр — вернуть как был. */
  function toggle(point?: { clientX: number; clientY: number }): void {
    if (zoomed) {
      setZoom(NONE)
      return
    }
    // Центр — по оправе, а не по сцене: прямоугольник сцены уже искажён трансформацией.
    const rect = stageRef.current?.parentElement?.getBoundingClientRect()
    if (!point || !rect) {
      setZoom(clamp({ s: MEDIA_ZOOM, x: 0, y: 0 }))
      return
    }
    // Точка под курсором остаётся на месте: сдвиг = −(смещение от центра)·(s − 1).
    const dx = point.clientX - (rect.left + rect.width / 2)
    const dy = point.clientY - (rect.top + rect.height / 2)
    setZoom(clamp({ s: MEDIA_ZOOM, x: -dx * (MEDIA_ZOOM - 1), y: -dy * (MEDIA_ZOOM - 1) }))
  }

  function onDoubleClick(e: ReactMouseEvent): void {
    toggle({ clientX: e.clientX, clientY: e.clientY })
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>): void {
    if (!zoomed || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: zoom.x, y: zoom.y, moved: false }
    setDragging(true)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>): void {
    const d = drag.current
    if (!d) return
    d.moved ||= Math.hypot(e.clientX - d.px, e.clientY - d.py) > 3
    setZoom((z) => clamp({ s: z.s, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }))
  }

  function onPointerUp(): void {
    drag.current = null
    setDragging(false)
  }

  const stageStyle: CSSProperties = {
    transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`,
    // Во время перетаскивания кадр идёт за пальцем без задержки; щелчок зума — плавно.
    transition: dragging || prefersReducedMotion() ? 'none' : 'transform 180ms ease-out',
    willChange: zoomed ? 'transform' : undefined,
  }

  return {
    zoomed,
    dragging,
    stageRef,
    stageStyle,
    toggle,
    reset,
    handlers: {
      onDoubleClick,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}
