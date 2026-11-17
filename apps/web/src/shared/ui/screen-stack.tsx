'use client'

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '../lib/utils'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
  type SpringHandle,
} from '../lib/spring'
import { useBackClose } from '../lib/use-back-close'
import { isIosDevice, isStandalonePwa } from '../lib/platform'

// Стек из двух экранов: нижний (список) и верхний (переписка, панель настроек), который
// въезжает поверх него справа. Раскладка и поведение — как у слоёв мессенджера:
//
//  · верхний экран едет справа налево на всю ширину, нижний в это время отступает влево на
//    пятую часть ширины и темнеет — глаз видит, что новый экран лёг поверх, а не заменил;
//  · назад — свайпом от левого края: экран идёт за пальцем 1:1, решение «закрыть или
//    вернуть» принимается по точке, где он остановился бы сам (projectMomentum), доводка —
//    пружиной со скоростью пальца;
//  · едущий экран можно схватить в любой момент и развернуть — флага «идёт анимация»,
//    глушащего ввод, нет (DESIGN_SYSTEM §7.1);
//  · `prefers-reduced-motion` — сразу конечное положение, без въезда и доводки.
//
// Положение пишется прямо в style (transform/opacity) из пружины, а не через состояние
// React: шестьдесят перерисовок окна чата в секунду ради одного сдвига — лишняя работа.
// Покой — без transform вовсе: преобразованный предок делает `position: fixed` потомков
// относительными себе, и меню внутри экрана поехали бы вместе с ним.

/** Насколько нижний экран отступает, пока верхний полностью закрывает его (доля ширины). */
const PARALLAX = 0.2
/** Плотность затемнения нижнего экрана под открытым верхним (слой `bg-overlay`). */
const DIM_MAX = 0.15
/** Зона у левого края верхнего экрана, откуда тянут «назад», px. */
const EDGE_ZONE = 24
/** Сдвиг пальца, после которого понятно, горизонтальный это жест или прокрутка, px. */
const START_SLOP = 8
/**
 * Открытие сразу после монтирования — без въезда: экран, открытый ссылкой (`?chat=`),
 * должен встретить человека готовым, а не проигрывать переход, которого тот не делал.
 */
const INITIAL_GRACE_MS = 400
/** Пружина перемещения экрана: без перелёта (§7.1, «перемещение, возврат»). */
const STACK_DAMPING = 1
const STACK_RESPONSE = 0.4

export interface ScreenStackOptions {
  /** Верхний экран показан. Состояние держит родитель. */
  open: boolean
  /**
   * Снять верхний экран. Зовётся, когда уход доехал до конца (или сразу — без анимации):
   * до этого родитель продолжает рисовать верхний экран, и уезжает живое содержимое.
   */
  onClose: () => void
  /**
   * Переходы и жест включены. Выключают там, где экраны стоят рядом (широкий экран): ехать
   * некуда, слои просто показаны оба.
   */
  enabled?: boolean
  /** Ширина зоны у левого края, откуда тянут «назад», px. */
  edgeZone?: number
}

export interface ScreenStackController<TTop extends HTMLElement = HTMLDivElement> {
  /** Обёртка нижнего экрана: отступает и темнеет. */
  baseRef: RefObject<HTMLDivElement | null>
  /** Верхний экран: въезжает, его тянут от края. */
  topRef: RefObject<TTop | null>
  /** Затемнение поверх нижнего экрана (`absolute inset-0 bg-overlay opacity-0`). */
  dimRef: RefObject<HTMLDivElement | null>
  /** Увести верхний экран и по приезде вызвать `onClose`. `instant` — без анимации. */
  close: (options?: { instant?: boolean }) => void
  /**
   * Закрытие системной «назад». В Safari на iOS (вкладка, не установленное приложение) жест
   * «назад» от края браузер анимирует сам, снимком страницы, — второй проезд поверх него
   * выглядел бы двойным, поэтому там экран снимается сразу.
   */
  closeFromHistory: () => void
  /**
   * Ключ записи в истории. Меняется, когда закрытие системной «назад» перехватили пальцем и
   * экран остался: запись браузер уже снял, и её нужно положить заново — иначе следующая
   * «назад» увела бы со страницы. Отдавайте его в `key` у `<BackCloseWhileOpen>`.
   */
  historyKey: number
}

interface StackState {
  spring: SpringHandle
  width: number
  /** Пружина сейчас уводит верхний экран, и по приезде его надо снять. */
  closing: boolean
  /** Текущее закрытие начато системной «назад». */
  fromHistory: boolean
}

/** Двухэкранный стек с въездом, свайпом назад от края и прерываемой доводкой. */
export function useScreenStack<TTop extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  enabled = true,
  edgeZone = EDGE_ZONE,
}: ScreenStackOptions): ScreenStackController<TTop> {
  const baseRef = useRef<HTMLDivElement | null>(null)
  const topRef = useRef<TTop | null>(null)
  const dimRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const openRef = useRef(open)
  openRef.current = open
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const [historyKey, setHistoryKey] = useState(0)

  const stateRef = useRef<StackState | null>(null)

  // Единственная точка правды о положении: и палец, и пружина пишут через неё.
  const render = useCallback((x: number): void => {
    const s = stateRef.current
    const width = s?.width || 1
    // 1 — верхний экран на месте и закрывает нижний целиком, 0 — уехал.
    const progress = 1 - Math.min(Math.max(x / width, 0), 1)
    const top = topRef.current
    const base = baseRef.current
    const dim = dimRef.current
    if (top) top.style.transform = x === 0 ? '' : `translate3d(${x}px, 0, 0)`
    if (base) {
      base.style.transform =
        progress === 0 ? '' : `translate3d(${-PARALLAX * width * progress}px, 0, 0)`
    }
    if (dim) dim.style.opacity = String(DIM_MAX * progress)
  }, [])

  // Нижний экран под неподвижным верхним не виден, но остаётся в дереве: прячем его от
  // экранного диктора и Tab (visibility), а заодно от отрисовки. Показываем, как только
  // верхний экран сдвинулся.
  const cover = useCallback((covered: boolean): void => {
    const base = baseRef.current
    if (base) base.style.visibility = covered ? 'hidden' : ''
  }, [])

  const reset = useCallback((): void => {
    const top = topRef.current
    const base = baseRef.current
    const dim = dimRef.current
    if (top) top.style.transform = ''
    if (base) {
      base.style.transform = ''
      base.style.visibility = ''
    }
    if (dim) dim.style.opacity = '0'
  }, [])

  const machine = useCallback((): StackState => {
    if (stateRef.current) return stateRef.current
    const state: StackState = {
      width: 1,
      closing: false,
      fromHistory: false,
      spring: createSpring({
        from: 0,
        damping: STACK_DAMPING,
        response: STACK_RESPONSE,
        onChange: (x) => render(x),
        onRest: () => {
          const s = stateRef.current
          if (!s) return
          if (s.closing) {
            s.closing = false
            s.fromHistory = false
            onCloseRef.current()
          } else if (s.spring.value === 0) {
            cover(true)
          }
        },
      }),
    }
    stateRef.current = state
    return state
  }, [render, cover])

  const widthOf = (): number => topRef.current?.offsetWidth || window.innerWidth || 1

  // Момент монтажа — отсчёт для «открыто ссылкой» (см. INITIAL_GRACE_MS). Ставится в первом
  // layout-эффекте: обычный эффект отработал бы позже него.
  const mountedAtRef = useRef<number | null>(null)
  useEffect(() => () => stateRef.current?.spring.stop(), [])

  // Открытие и снятие. Layout-эффект — чтобы стартовое положение «за правым краем» встало
  // до первого кадра: иначе экран мелькнул бы на месте и только потом уехал вправо.
  // Стартовое «было закрыто»: экран, открытый уже при монтаже, проходит ту же ветку
  // открытия и встаёт на место без въезда (грейс монтажа).
  const prevRef = useRef({ open: false, enabled })
  useLayoutEffect(() => {
    if (mountedAtRef.current === null) mountedAtRef.current = performance.now()
    const prev = prevRef.current
    prevRef.current = { open, enabled }
    const s = machine()
    if (!enabled) {
      s.spring.stop()
      s.closing = false
      s.spring.set(0)
      reset()
      return
    }
    if (!open) {
      if (prev.open) {
        // Сняли — сами по приезде или родитель напрямую. Нижний экран на место.
        s.spring.stop()
        s.closing = false
        s.fromHistory = false
        s.spring.set(0)
        reset()
      }
      return
    }
    if (prev.open && prev.enabled) return
    // Открыли (или включили стек при уже открытом экране — поворот телефона).
    s.closing = false
    s.width = widthOf()
    const instant =
      !prev.enabled ||
      prev.open ||
      prefersReducedMotion() ||
      performance.now() - (mountedAtRef.current ?? 0) < INITIAL_GRACE_MS
    if (instant) {
      s.spring.set(0)
      render(0)
      cover(true)
      return
    }
    cover(false)
    s.spring.set(s.width)
    render(s.width)
    s.spring.to(0)
  }, [open, enabled, machine, render, reset, cover])

  const close = useCallback(
    (options?: { instant?: boolean }): void => {
      if (!openRef.current) return
      const s = machine()
      if (!enabledRef.current || options?.instant || prefersReducedMotion()) {
        s.spring.stop()
        s.closing = false
        onCloseRef.current()
        return
      }
      if (s.closing) return
      s.width = widthOf()
      s.closing = true
      cover(false)
      s.spring.to(s.width)
    },
    [machine, cover],
  )

  const closeFromHistory = useCallback((): void => {
    const s = machine()
    s.fromHistory = true
    close({ instant: isIosDevice() && !isStandalonePwa() })
  }, [machine, close])

  // Свайп назад от левого края. Нативные слушатели в фазе перехвата: касание у края
  // забираем целиком, и вложенные жесты (свайп «ответить» по пузырю, долгое нажатие) его
  // не получают — иначе вправо поехали бы и экран, и пузырь под пальцем.
  useEffect(() => {
    const top = topRef.current
    if (!top || !enabled || !open) return
    const s = machine()

    type Track = {
      startX: number
      startY: number
      grabX: number
      decided: boolean
      ignored: boolean
      /** Палец сдвинулся дальше порога — это жест, а не касание. */
      moved: boolean
      /**
       * Куда ехал пойманный на лету экран. Касание без движения (второй тап по строке,
       * пока чат ещё въезжает) не должно разворачивать экран — доводка продолжается.
       */
      resume: { target: number; closing: boolean; fromHistory: boolean } | null
      history: { position: number; time: number }[]
    }
    let track: Track | null = null

    const settle = (velocity: number): void => {
      const x = s.spring.value
      const projected = x + projectMomentum(velocity)
      const closing = projected > s.width / 2
      if (prefersReducedMotion()) {
        s.spring.set(closing ? s.width : 0)
        render(s.spring.value)
        if (closing) {
          s.closing = false
          onCloseRef.current()
        } else {
          cover(true)
        }
        return
      }
      s.closing = closing
      // Скорость пальца — начальная скорость пружины: шва между жестом и доводкой нет.
      s.spring.to(closing ? s.width : 0, velocity)
    }

    const onStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        track = null
        return
      }
      const touch = e.touches[0]!
      const catching = s.spring.animating
      if (!catching && touch.clientX - top.getBoundingClientRect().left > edgeZone) return
      e.stopPropagation()
      let resume: Track['resume'] = null
      if (catching) {
        // Перехват на лету: экран замирает под пальцем там, где он сейчас на экране.
        resume = {
          target: s.closing ? s.width : 0,
          closing: s.closing,
          fromHistory: s.fromHistory,
        }
        s.spring.stop()
        s.closing = false
        s.fromHistory = false
        s.width = widthOf()
        cover(false)
      }
      track = {
        startX: touch.clientX,
        startY: touch.clientY,
        grabX: s.spring.value,
        decided: catching,
        ignored: false,
        moved: false,
        resume,
        history: [{ position: touch.clientX, time: e.timeStamp }],
      }
    }

    const onMove = (e: TouchEvent): void => {
      if (!track) return
      e.stopPropagation()
      const touch = e.touches[0]
      if (!touch || track.ignored) return
      const dx = touch.clientX - track.startX
      const dy = touch.clientY - track.startY
      if (Math.abs(dx) >= START_SLOP || Math.abs(dy) >= START_SLOP) track.moved = true
      if (!track.decided) {
        if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return
        // Вертикальное движение или влево — это прокрутка, не «назад».
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
          track.ignored = true
          return
        }
        track.decided = true
        s.width = widthOf()
        cover(false)
      }
      if (e.cancelable) e.preventDefault()
      track.history.push({ position: touch.clientX, time: e.timeStamp })
      if (track.history.length > 8) track.history.shift()
      const raw = track.grabX + dx
      // Левее открытого положения экран не упирается, а вязнет (§9).
      const x = raw >= 0 ? raw : -rubberband(-raw, s.width)
      s.spring.set(x)
      render(x)
    }

    const onEnd = (e: TouchEvent): void => {
      if (!track) return
      e.stopPropagation()
      const done = track
      track = null
      const { resume } = done
      if (resume && (!done.moved || done.ignored)) {
        // Поймали и отпустили на месте — экран продолжает путь, куда ехал.
        s.closing = resume.closing
        s.fromHistory = resume.fromHistory
        s.spring.to(resume.target)
        return
      }
      if (!done.decided || done.ignored) return
      settle(e.type === 'touchcancel' ? 0 : velocityFrom(done.history))
      if (resume?.fromHistory && !s.closing) {
        // Закрытие системной «назад» развернули пальцем: запись в истории браузер уже
        // снял — кладём новую, иначе следующая «назад» увела бы со страницы.
        setHistoryKey((k) => k + 1)
      }
    }

    top.addEventListener('touchstart', onStart, { capture: true, passive: true })
    top.addEventListener('touchmove', onMove, { capture: true, passive: false })
    top.addEventListener('touchend', onEnd, { capture: true })
    top.addEventListener('touchcancel', onEnd, { capture: true })
    return () => {
      top.removeEventListener('touchstart', onStart, { capture: true })
      top.removeEventListener('touchmove', onMove, { capture: true })
      top.removeEventListener('touchend', onEnd, { capture: true })
      top.removeEventListener('touchcancel', onEnd, { capture: true })
    }
  }, [open, enabled, edgeZone, machine, render, cover])

  return { baseRef, topRef, dimRef, close, closeFromHistory, historyKey }
}

/**
 * Пока смонтирован — системная «назад» закрывает экран, а не уходит со страницы.
 * Обёртка над `useBackClose`, у которого нет флага «включён»: включают её монтажом.
 */
export function BackCloseWhileOpen({ onBack }: { onBack: () => void }): null {
  useBackClose(onBack)
  return null
}

export interface ScreenStackHandle {
  /** Увести верхний экран (с анимацией) и снять его. */
  close: (options?: { instant?: boolean }) => void
}

export interface ScreenStackProps {
  open: boolean
  onClose: () => void
  /** Нижний экран — всегда в дереве. */
  base: ReactNode
  /** Верхний экран — рисуется, пока `open`. */
  top: ReactNode
  className?: string
  /** Системная «назад» снимает верхний экран. */
  backClose?: boolean
  /** Ручка для кнопки «назад» внутри верхнего экрана: закрыть с уездом, а не мгновенно. */
  handleRef?: RefObject<ScreenStackHandle | null>
}

/**
 * Готовый стек для случая, когда оба экрана живут в одном контейнере (колонка списка
 * чатов и её панели). Контейнер растягивается по родителю; верхний экран лежит поверх
 * нижнего во всю его площадь.
 */
export function ScreenStack({
  open,
  onClose,
  base,
  top,
  className,
  backClose = false,
  handleRef,
}: ScreenStackProps) {
  const stack = useScreenStack({ open, onClose })
  useImperativeHandle(handleRef, () => ({ close: stack.close }), [stack.close])
  return (
    <div className={cn('relative flex min-h-0 overflow-hidden', className)}>
      <div ref={stack.baseRef} className="relative flex min-h-0 min-w-0 flex-1">
        {base}
        <div
          ref={stack.dimRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-overlay opacity-0"
        />
      </div>
      {open && (
        <div ref={stack.topRef} className="absolute inset-0 z-20 flex min-h-0 bg-background">
          {top}
        </div>
      )}
      {open && backClose && (
        <BackCloseWhileOpen key={stack.historyKey} onBack={stack.closeFromHistory} />
      )}
    </div>
  )
}
