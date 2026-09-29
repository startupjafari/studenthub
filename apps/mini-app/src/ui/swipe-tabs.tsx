import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { haptic } from '../telegram/webapp'
import { navigate } from '../lib/navigate'

/** Сдвиг, после которого жест считается горизонтальным, а не прокруткой страницы. */
const SLOP = 12
/** Доля ширины экрана, за которой раздел переключается. Меньше — содержимое встаёт на место. */
const COMMIT_RATIO = 0.22
/** Потолок порога: на планшете 22% ширины — это уже неудобно далеко. */
const COMMIT_MAX = 96
/** Сопротивление у крайних разделов: тянется, но заметно тяжелее. */
const EDGE_DAMPING = 4

/**
 * Куда нельзя пускать жест разделов.
 *
 * `.swipe` — строки со своими свайпами (взять/отложить), `.tabs`, `.chips` и лента
 * заготовок прокручиваются вбок сами, поля ввода тянут каретку и выделение. Перехватывать
 * палец у них значило бы ломать то, что уже работает, ради того же самого движения.
 */
const BLOCKED = '.swipe, .tabs, .chips, .composer-templates, input, textarea, [data-no-swipe]'

/**
 * Листание разделов пальцем.
 *
 * Четыре раздела внизу — это четыре соседние страницы, а не уровни вложенности, и между
 * соседями в телефоне ходят смахиванием: тянуться большим пальцем к панели ради перехода
 * в соседнюю вкладку дольше, чем провести по экрану там, где он уже есть.
 *
 * Содержимое едет ЗА пальцем, а не переключается по факту отпускания. Разница
 * принципиальная: пока палец на экране, видно, что жест понят и куда он ведёт, — и его
 * можно передумать, вернув палец назад. Переключение по факту отпускания даёт бинарный
 * исход без обратной связи, и промахнувшийся узнаёт об этом, только когда экран уже
 * сменился.
 *
 * У крайних разделов тянется с сопротивлением: упор пальцем честнее, чем неподвижный
 * экран, — по нему сразу понятно, что это край, а не что жест не сработал.
 *
 * Само переключение отдаётся `navigate`: тот же переход, что и при нажатии на панель,
 * и та же настройка «меньше движения». Сдвиг снимается ДО перехода (flushSync), иначе
 * View Transitions снял бы кадр «до» с уехавшим содержимым и слайд удвоился бы.
 */
export function SwipeTabs<T extends string>({
  ids,
  active,
  onSelect,
  children,
}: {
  /** Разделы в том порядке, в каком они стоят на панели. */
  ids: readonly T[]
  active: T
  onSelect: (id: T) => void
  children: ReactNode
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  // Сдвиг дублируется в ref: решение об отпускании принимается по нему, а не по
  // состоянию. React перерисовывает не синхронно с событием, и между последним движением
  // и отпусканием кадра может не случиться — обработчик отпускания увидел бы прежний
  // сдвиг и не переключил раздел. Состояние остаётся ради самой отрисовки.
  const dxRef = useRef(0)
  // Жест закончился — клик, который браузер пришлёт следом, открывать карточку не должен:
  // человек листал, а не нажимал по строке под пальцем.
  const swallowClick = useRef(false)

  const index = ids.indexOf(active)

  const reset = (): void => {
    start.current = null
    dxRef.current = 0
    setDragging(false)
    setDx(0)
  }

  /** Сосед в сторону движения пальца. Тянем влево — идём вправо по списку разделов. */
  const neighbour = (delta: number): T | null => {
    if (index < 0) return null
    const next = ids[index + (delta < 0 ? 1 : -1)]
    return next ?? null
  }

  return (
    <div
      className={`swipe-tabs${dragging ? ' dragging' : ''}`}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return // мышью разделы переключают панелью
        if ((e.target as Element | null)?.closest?.(BLOCKED)) return
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
            // Захват указателя: без него палец, ушедший за край экрана, перестаёт слать
            // события, `pointerup` не приходит — и содержимое остаётся сдвинутым навсегда.
            e.currentTarget.setPointerCapture?.(e.pointerId)
            setDragging(true)
          }
        }
        if (s.axis !== 'x') return
        const next = neighbour(mx) ? mx : mx / EDGE_DAMPING
        dxRef.current = next
        setDx(next)
      }}
      onPointerUp={() => {
        const s = start.current
        if (s?.axis !== 'x') {
          reset()
          return
        }
        swallowClick.current = true
        const moved = dxRef.current
        const width = window.innerWidth || 390
        const commit = Math.min(width * COMMIT_RATIO, COMMIT_MAX)
        const next = Math.abs(moved) >= commit ? neighbour(moved) : null
        if (!next) {
          reset()
          return
        }
        haptic.select()
        // Сдвиг снимаем отдельным синхронным кадром — см. комментарий к компоненту.
        dxRef.current = 0
        flushSync(() => {
          setDx(0)
          setDragging(false)
        })
        start.current = null
        navigate(() => onSelect(next), moved < 0 ? 'forward' : 'back')
      }}
      onPointerCancel={reset}
      onClickCapture={(e) => {
        if (!swallowClick.current) return
        e.preventDefault()
        e.stopPropagation()
        swallowClick.current = false
      }}
    >
      {children}
    </div>
  )
}
