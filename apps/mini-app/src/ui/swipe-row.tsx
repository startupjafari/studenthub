import { useRef, useState, type ReactNode } from 'react'
import { haptic } from '../telegram/webapp'

/** Действие, которое открывается свайпом по строке. */
export interface SwipeAction {
  label: string
  /** Цвет подложки: `neutral` — обратимое, `accent` — «взять себе». */
  tone: 'neutral' | 'accent'
  onCommit: () => void
}

/** Сколько протянуть, чтобы действие сработало. Меньше — строка возвращается на место. */
const THRESHOLD = 88
/** Сдвиг, после которого жест считается горизонтальным, а не прокруткой списка. */
const SLOP = 10

/**
 * Строка со свайпами, как в Почте iOS: влево — одно действие, вправо — другое.
 *
 * Жест — ускоритель, а не единственный путь: то же самое есть на карточке, и строка без
 * свайпа работает как обычная кнопка. Поэтому действия здесь только обратимые — то, что
 * нельзя отменить, свайпом не делается никогда: палец соскальзывает чаще, чем кажется.
 *
 * Горизонтальный жест начинается, только если палец ушёл вбок дальше, чем вниз: иначе
 * строка перехватывала бы прокрутку очереди. Пройденный порог отмечается отдачей —
 * человек чувствует «сработает, если отпустить», не глядя на подложку.
 */
export function SwipeRow({
  children,
  left,
  right,
}: {
  children: ReactNode
  /** Открывается свайпом вправо (подложка слева). */
  left?: SwipeAction
  /** Открывается свайпом влево (подложка справа). */
  right?: SwipeAction
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const armed = useRef(false)
  // Жест закончился на строке — клик, который браузер пришлёт следом, открывать карточку
  // не должен: человек тянул, а не нажимал.
  const swallowClick = useRef(false)

  const reset = (): void => {
    start.current = null
    armed.current = false
    setDragging(false)
    setDx(0)
  }

  const action = dx > 0 ? left : dx < 0 ? right : undefined
  const progress = Math.min(1, Math.abs(dx) / THRESHOLD)

  return (
    <div className="swipe">
      {action && (
        <div
          className={`swipe-under swipe-${action.tone} ${dx > 0 ? 'from-left' : 'from-right'}`}
          aria-hidden
        >
          <span style={{ opacity: 0.4 + 0.6 * progress }}>{action.label}</span>
        </div>
      )}
      <div
        className={`swipe-top${dragging ? '' : ' settling'}`}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          start.current = { x: e.clientX, y: e.clientY, axis: null }
          swallowClick.current = false
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s) return
          const mx = e.clientX - s.x
          const my = e.clientY - s.y
          if (s.axis === null) {
            if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
            s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
            if (s.axis === 'x') {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragging(true)
            }
          }
          if (s.axis !== 'x') return
          // Туда, где действия нет, строка тянется с сопротивлением — видно, что жест
          // понят, но делать там нечего.
          const allowed = (mx > 0 && left) || (mx < 0 && right)
          const next = allowed ? mx : mx / 5
          setDx(next)
          const over = allowed && Math.abs(next) >= THRESHOLD
          if (over !== armed.current) {
            armed.current = !!over
            if (over) haptic.snap()
          }
        }}
        onPointerUp={() => {
          const s = start.current
          if (s?.axis === 'x') {
            swallowClick.current = true
            if (armed.current) action?.onCommit()
          }
          reset()
        }}
        onPointerCancel={reset}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.preventDefault()
            e.stopPropagation()
            swallowClick.current = false
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
