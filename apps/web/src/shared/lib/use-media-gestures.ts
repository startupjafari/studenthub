'use client'

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
} from './spring'

// Жест «приблизить двумя пальцами» для полноэкранного просмотрщика.
//
// Физика — apple-design §2–§6, §9:
//  · слежение 1:1: точка снимка, за которую схватили, остаётся под пальцами всю дорогу —
//    поэтому зум «тянется» из места щипка, а не из центра экрана;
//  · за пределами хода (меньше 1:1, больше предела, край снимка) — резина, а не стена;
//  · отпустили — пружина возвращает в границы, подхватывая скорость пальца, так что шва
//    между жестом и доводкой нет;
//  · доводку можно поймать пальцем в любой момент и продолжить жест оттуда.
//
// Два элемента: `surfaceRef` — область, которая ловит касания и задаёт видимое окно;
// `layerRef` — слой внутри неё, к которому применяется `translate + scale`. Слой обёрнут
// вокруг медиа, поэтому собственные трансформации снимка (поворот, вписывание) остаются
// нетронутыми — зум просто накладывается сверху.
//
// touchmove держим отдельным нативным слушателем с `{ passive: false }` ради preventDefault:
// без него жест параллельно уходит в страницу (iOS pull-to-refresh), а `gesturestart` —
// ради Safari, который иначе масштабирует всю страницу вместо снимка.

/** Дальше приближать нечего: на экране уже пиксели, а не снимок. */
const MAX_SCALE = 5
/** Во сколько раз приближает двойной тап. */
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 30
/** Гистерезис: движение короче этого — тап, а не жест (§10). */
const MOVE_SLOP = 6
/** Масштаб возвращается в границы без перелёта; панорамирование брошено пальцем — с лёгким (§4). */
const SCALE_DAMPING = 1
const SCALE_RESPONSE = 0.35
const PAN_DAMPING = 0.85
const PAN_RESPONSE = 0.4

interface Point {
  x: number
  y: number
}

export interface PinchZoomOptions {
  /** Само медиа: по его размеру считаются границы панорамирования. */
  content: RefObject<HTMLElement | null>
  /** Выключить жест (видео: щипок отобрал бы касания у собственных контролов плеера). */
  disabled?: boolean
  maxScale?: number
}

export interface PinchZoomController {
  /** На область жеста — она же видимое окно, за границы которого снимок не уезжает. */
  surfaceRef: RefObject<HTMLDivElement | null>
  /** На слой вокруг медиа — его двигаем и масштабируем. */
  layerRef: RefObject<HTMLDivElement | null>
  /** Вернуть 1:1 — при смене снимка и повороте. */
  reset: () => void
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function usePinchZoom({
  content,
  disabled = false,
  maxScale = MAX_SCALE,
}: PinchZoomOptions): PinchZoomController {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  // Сброс приходит из эффекта, но вызывают его снаружи — прокладка, чтобы возвращаемая
  // функция не менялась между рендерами.
  const resetRef = useRef<() => void>(() => {})

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || disabled) return

    // Единственная правда о положении снимка: и жест, и пружины пишут сюда.
    let sc = 1
    let px = 0
    let py = 0

    const draw = (): void => {
      const layer = layerRef.current
      if (!layer) return
      layer.style.transform =
        sc === 1 && px === 0 && py === 0 ? '' : `translate3d(${px}px, ${py}px, 0) scale(${sc})`
    }

    // Три независимые пружины, а не одна на «расстояние»: по осям разные скорости, и общая
    // пружина их рассинхронизирует (§3).
    const scale = createSpring({
      from: 1,
      damping: SCALE_DAMPING,
      response: SCALE_RESPONSE,
      onChange: (v) => {
        sc = v
        draw()
      },
    })
    const panX = createSpring({
      from: 0,
      damping: PAN_DAMPING,
      response: PAN_RESPONSE,
      onChange: (v) => {
        px = v
        draw()
      },
    })
    const panY = createSpring({
      from: 0,
      damping: PAN_DAMPING,
      response: PAN_RESPONSE,
      onChange: (v) => {
        py = v
        draw()
      },
    })

    const apply = (s: number, x: number, y: number): void => {
      scale.set(s)
      panX.set(x)
      panY.set(y)
      sc = s
      px = x
      py = y
      draw()
    }

    // Габарит снимка при 1:1. Меряем рамкой, а не offsetWidth: снимок бывает повёрнут, и
    // нужен именно тот прямоугольник, который он занимает на экране. Делим на текущий
    // масштаб — рамка уже включает наш зум.
    let baseW = 0
    let baseH = 0
    const measure = (): void => {
      const el = content.current
      if (!el) return
      const r = el.getBoundingClientRect()
      baseW = r.width / sc
      baseH = r.height / sc
    }

    /** Предел сдвига: снимок не уезжает краем внутрь окна, пока он больше окна. */
    const limit = (s: number): Point => ({
      x: Math.max(0, (baseW * s - surface.clientWidth) / 2),
      y: Math.max(0, (baseH * s - surface.clientHeight) / 2),
    })

    const clamp = (v: number, bound: number): number => Math.min(bound, Math.max(-bound, v))

    /** За границей хода палец слушается всё хуже, но слушается (§9). */
    const soft = (v: number, bound: number, size: number): number => {
      const over = Math.abs(v) - bound
      if (over <= 0) return v
      return Math.sign(v) * (bound + rubberband(over, size))
    }

    const softScale = (raw: number): number => {
      if (raw < 1) return 1 - rubberband(1 - raw, 1)
      if (raw > maxScale) return maxScale + rubberband(raw - maxScale, 1)
      return raw
    }

    /** Точка в координатах слоя: от центра окна, потому что масштаб растёт от центра. */
    const local = (clientX: number, clientY: number): Point => {
      const r = surface.getBoundingClientRect()
      return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
    }

    const points = new Map<number, Point>()
    let startScale = 1
    let startDist = 0
    let startPoint: Point = { x: 0, y: 0 }
    // Точка СНИМКА под пальцами в момент захвата — её и держим на месте весь жест.
    let anchor: Point = { x: 0, y: 0 }
    let historyX: { position: number; time: number }[] = []
    let historyY: { position: number; time: number }[] = []
    let moved = false
    let pinched = false
    let swallowClick = false
    let lastTapTime = 0
    let lastTapPoint: Point = { x: 0, y: 0 }

    const active = (): Point[] => [...points.values()].slice(0, 2)

    const center = (list: Point[]): Point =>
      list.length > 1
        ? { x: (list[0]!.x + list[1]!.x) / 2, y: (list[0]!.y + list[1]!.y) / 2 }
        : list[0]!

    // Перезахват: вызывается и на постановке пальца, и на снятии. Без него снятие одного
    // пальца из щипка швыряло бы снимок — середина касаний скачком уезжает на оставшийся.
    const grab = (): void => {
      const list = active()
      if (list.length === 0) return
      const p = local(center(list).x, center(list).y)
      startDist = list.length > 1 ? distance(list[0]!, list[1]!) : 0
      startScale = sc
      startPoint = p
      anchor = { x: (p.x - px) / sc, y: (p.y - py) / sc }
      const time = performance.now()
      historyX = [{ position: p.x, time }]
      historyY = [{ position: p.y, time }]
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // Снимок едет — перехватываем его на текущем месте: доводка прерываема (§3).
      scale.stop()
      panX.stop()
      panY.stop()
      sc = scale.value
      px = panX.value
      py = panY.value
      if (points.size === 0) {
        moved = false
        pinched = false
        measure()
      }
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      surface.setPointerCapture(e.pointerId)
      grab()
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!points.has(e.pointerId)) return
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const list = active()
      const pinching = list.length > 1
      // Одним пальцем возить нечего, пока снимок вписан в экран.
      if (!pinching && sc <= 1) return
      if (pinching) pinched = true

      const p = local(center(list).x, center(list).y)
      const s =
        pinching && startDist > 0
          ? softScale((startScale * distance(list[0]!, list[1]!)) / startDist)
          : sc
      const bound = limit(s)
      const x = soft(p.x - anchor.x * s, bound.x, surface.clientWidth)
      const y = soft(p.y - anchor.y * s, bound.y, surface.clientHeight)

      if (!moved && distance(p, startPoint) > MOVE_SLOP) moved = true
      const time = performance.now()
      historyX.push({ position: p.x, time })
      historyY.push({ position: p.y, time })
      if (historyX.length > 8) {
        historyX.shift()
        historyY.shift()
      }
      apply(s, x, y)
    }

    const settle = (): void => {
      const target = Math.min(maxScale, Math.max(1, sc))
      const bound = limit(target)
      // Брошенный пальцем снимок доезжает сам (§6) — но только если это было чистое
      // панорамирование: после щипка бросок читается как случайный рывок.
      const vx = pinched ? 0 : velocityFrom(historyX)
      const vy = pinched ? 0 : velocityFrom(historyY)
      const x = target === 1 ? 0 : clamp(px + projectMomentum(vx), bound.x)
      const y = target === 1 ? 0 : clamp(py + projectMomentum(vy), bound.y)

      if (prefersReducedMotion()) {
        apply(target, x, y)
        return
      }
      scale.to(target)
      // Скорость пальца становится начальной скоростью пружины — шва не остаётся (§5).
      panX.to(x, vx)
      panY.to(y, vy)
    }

    const zoomTo = (target: number, clientX: number, clientY: number): void => {
      measure()
      const p = local(clientX, clientY)
      const u = { x: (p.x - px) / sc, y: (p.y - py) / sc }
      const bound = limit(target)
      const x = target === 1 ? 0 : clamp(p.x - u.x * target, bound.x)
      const y = target === 1 ? 0 : clamp(p.y - u.y * target, bound.y)
      if (prefersReducedMotion()) {
        apply(target, x, y)
        return
      }
      scale.to(target)
      panX.to(x)
      panY.to(y)
    }

    /** Тап по снимку: второй подряд — приблизить/вернуть. Тап по пустому полю не наш. */
    const onTap = (e: PointerEvent): void => {
      const el = content.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!inside) return
      const now = performance.now()
      const double =
        now - lastTapTime < DOUBLE_TAP_MS &&
        distance({ x: e.clientX, y: e.clientY }, lastTapPoint) < DOUBLE_TAP_SLOP
      if (double) {
        lastTapTime = 0
        swallowClick = true
        zoomTo(sc > 1.05 ? 1 : Math.min(DOUBLE_TAP_SCALE, maxScale), e.clientX, e.clientY)
        return
      }
      lastTapTime = now
      lastTapPoint = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (!points.delete(e.pointerId)) return
      if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId)
      if (points.size > 0) {
        grab()
        return
      }
      if (moved) settle()
      else onTap(e)
    }

    // Жест не должен превращаться в клик: иначе отпускание после панорамирования закрывало
    // бы просмотрщик (клик по фону = закрыть).
    const onClickCapture = (e: MouseEvent): void => {
      if (!moved && !swallowClick) return
      moved = false
      swallowClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    // Не отдать жест странице. Слушатель обязан быть non-passive, иначе preventDefault
    // игнорируется (React вешает passive).
    const blockScroll = (e: TouchEvent): void => {
      if (points.size > 0 && e.cancelable) e.preventDefault()
    }
    // Safari масштабирует страницу своим жестом поверх нашего — просим его не вмешиваться.
    const blockNativeZoom = (e: Event): void => e.preventDefault()

    const reset = (): void => {
      points.clear()
      moved = false
      pinched = false
      swallowClick = false
      scale.stop()
      panX.stop()
      panY.stop()
      apply(1, 0, 0)
    }
    resetRef.current = reset

    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerup', onPointerUp)
    surface.addEventListener('pointercancel', onPointerUp)
    surface.addEventListener('click', onClickCapture, true)
    surface.addEventListener('touchmove', blockScroll, { passive: false })
    surface.addEventListener('gesturestart', blockNativeZoom)
    surface.addEventListener('gesturechange', blockNativeZoom)
    return () => {
      resetRef.current = () => {}
      scale.stop()
      panX.stop()
      panY.stop()
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerup', onPointerUp)
      surface.removeEventListener('pointercancel', onPointerUp)
      surface.removeEventListener('click', onClickCapture, true)
      surface.removeEventListener('touchmove', blockScroll)
      surface.removeEventListener('gesturestart', blockNativeZoom)
      surface.removeEventListener('gesturechange', blockNativeZoom)
    }
  }, [content, disabled, maxScale])

  const reset = useCallback((): void => resetRef.current(), [])

  return useMemo(() => ({ surfaceRef, layerRef, reset }), [reset])
}
