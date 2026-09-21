'use client'

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  createSpring,
  prefersReducedMotion,
  projectMomentum,
  rubberband,
  velocityFrom,
} from './spring'

// Жесты полноэкранного просмотрщика: приблизить щипком и пролистать свайпом.
//
// Физика — apple-design §2–§7, §9:
//  · слежение 1:1: точка снимка, за которую схватили, остаётся под пальцами всю дорогу —
//    поэтому зум «тянется» из места щипка, а не из центра экрана, а кадр при листании
//    едет ровно за пальцем;
//  · за пределами хода (меньше 1:1, больше предела, край снимка, крайний кадр) — резина,
//    а не стена;
//  · листать или вернуть решается по СПРОЕЦИРОВАННОЙ точке остановки: короткий резкий
//    флик листает, вялое перетаскивание на ту же дистанцию — нет;
//  · кадр уходит в ту сторону, куда его толкнули, а новый приходит с противоположной —
//    путь туда и обратно симметричен (§7);
//  · любую доводку можно поймать пальцем и продолжить жест оттуда.
//
// Какой это жест, решается один раз в начале: два пальца — зум; один палец по увеличенному
// снимку — панорамирование; один палец поперёк по вписанному — листание. Вертикаль
// просмотрщику не принадлежит.
//
// Два элемента: `surfaceRef` — область, которая ловит касания и задаёт видимое окно;
// `layerRef` — слой внутри неё, к которому применяется `translate + scale`. Слой обёрнут
// вокруг медиа, поэтому собственные трансформации снимка (поворот, вписывание) остаются
// нетронутыми — жест просто накладывается сверху.
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
/** Доля ширины экрана, за которой отпускание листает (по спроецированной точке). */
const PAGE_FRACTION = 0.3
/** Насколько горизонталь должна перевешивать вертикаль, чтобы жест считался листанием. */
const PAGE_BIAS = 1.2
/** Масштаб возвращается в границы без перелёта; брошенный пальцем кадр — с лёгким (§4). */
const SCALE_DAMPING = 1
const SCALE_RESPONSE = 0.35
const PAN_DAMPING = 0.85
const PAN_RESPONSE = 0.4
/**
 * Листание — отдельный характер той же пружины: без перелёта и заметно быстрее возни
 * пальцем. Кадр уходит к краю, и только на его покое подставляется следующий, поэтому с
 * мягкой панорамной настройкой (0.4 с) один свайп занимал почти секунду — палец давно
 * отпустили, а просмотрщик всё ещё «думает».
 */
const PAGE_DAMPING = 1
const PAGE_RESPONSE = 0.22

/** Жест не начинается на этой разметке: у контролов плеера свои касания. */
const SKIP_ATTR = 'data-gesture-skip'

type Mode = 'idle' | 'zoom' | 'page' | 'none'

interface Point {
  x: number
  y: number
}

export interface MediaGesturesOptions {
  /** Само медиа: по его размеру считаются границы панорамирования. */
  content: RefObject<HTMLElement | null>
  /** Выключить зум (видео: щипок отобрал бы касания у контролов плеера). Листание остаётся. */
  zoomDisabled?: boolean
  maxScale?: number
  /** Есть ли сосед в эту сторону: `1` — следующий, `-1` — предыдущий. */
  canPage?: (direction: 1 | -1) => boolean
  /** Пролистать. Вызывается, когда уходящий кадр доехал до края. */
  onPage?: (direction: 1 | -1) => void
}

export interface MediaGesturesController {
  /** На область жеста — она же видимое окно, за границы которого снимок не уезжает. */
  surfaceRef: RefObject<HTMLDivElement | null>
  /** На слой вокруг медиа — его двигаем и масштабируем. */
  layerRef: RefObject<HTMLDivElement | null>
  /** Вернуть 1:1 — при смене снимка и повороте. */
  reset: () => void
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

export function useMediaGestures({
  content,
  zoomDisabled = false,
  maxScale = MAX_SCALE,
  canPage,
  onPage,
}: MediaGesturesOptions): MediaGesturesController {
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  // Сброс приходит из эффекта, но вызывают его снаружи — прокладка, чтобы возвращаемая
  // функция не менялась между рендерами.
  const resetRef = useRef<() => void>(() => {})
  // Листание через ref, а не через зависимости эффекта: колбэки меняются на каждой смене
  // кадра, а пересоздание слушателей посреди жеста обрывало бы доводку.
  const canPageRef = useRef(canPage)
  const onPageRef = useRef(onPage)
  canPageRef.current = canPage
  onPageRef.current = onPage

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

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
      onRest: () => {
        if (pendingPage) finishPage()
        else entering = false
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

    /** Переключить характер горизонтальной пружины: листание — резкое, всё прочее — мягкое. */
    const tunePan = (paging: boolean): void => {
      panX.configure(
        paging
          ? { damping: PAGE_DAMPING, response: PAGE_RESPONSE }
          : { damping: PAN_DAMPING, response: PAN_RESPONSE },
      )
    }

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

    const width = (): number => surface.clientWidth || 1
    const canGo = (direction: 1 | -1): boolean => canPageRef.current?.(direction) ?? false

    const points = new Map<number, Point>()
    let mode: Mode = 'idle'
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
    /** Куда листаем, пока уходящий кадр едет к краю. */
    let pendingPage: 1 | -1 | null = null
    /** Новый кадр въезжает — сброс снаружи в это время только сбил бы его. */
    let entering = false

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
      if (list.length > 1) mode = zoomDisabled ? 'none' : 'zoom'
      else if (sc > 1) mode = 'zoom'
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as Element | null)?.closest?.(`[${SKIP_ATTR}]`)) return
      // Кадр едет — перехватываем его на текущем месте: доводка прерываема (§3). Уже
      // начатое листание при этом отменяется: палец снова главный.
      scale.stop()
      panX.stop()
      panY.stop()
      pendingPage = null
      entering = false
      sc = scale.value
      px = panX.value
      py = panY.value
      if (points.size === 0) {
        mode = 'idle'
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
      const p = local(center(list).x, center(list).y)
      const time = performance.now()
      historyX.push({ position: p.x, time })
      historyY.push({ position: p.y, time })
      if (historyX.length > 8) {
        historyX.shift()
        historyY.shift()
      }
      if (!moved && distance(p, startPoint) > MOVE_SLOP) moved = true

      // Намерение распознаём с первого движения и дальше не пересматриваем: иначе кадр
      // на полпути превращался бы то в листание, то в прокрутку.
      if (mode === 'idle') {
        const dx = Math.abs(p.x - startPoint.x)
        const dy = Math.abs(p.y - startPoint.y)
        if (dx < MOVE_SLOP && dy < MOVE_SLOP) return
        mode = dx > dy * PAGE_BIAS ? 'page' : 'none'
      }
      if (mode === 'none') return

      if (mode === 'page') {
        const dx = p.x - startPoint.x
        // За крайним кадром ничего нет — резина вместо стены (§9).
        const x = canGo(dx < 0 ? 1 : -1) ? dx : Math.sign(dx) * rubberband(Math.abs(dx), width())
        apply(1, x, 0)
        return
      }

      const pinching = list.length > 1
      if (pinching) pinched = true
      const s =
        pinching && startDist > 0
          ? softScale((startScale * distance(list[0]!, list[1]!)) / startDist)
          : sc
      const bound = limit(s)
      const x = soft(p.x - anchor.x * s, bound.x, surface.clientWidth)
      const y = soft(p.y - anchor.y * s, bound.y, surface.clientHeight)
      apply(s, x, y)
    }

    // Кадр доехал до края — меняем его и вводим новый с противоположной стороны. Смена
    // именно здесь, а не в момент отпускания: иначе новый снимок появлялся бы поверх
    // уезжающего старого.
    const finishPage = (): void => {
      const direction = pendingPage
      if (!direction) return
      pendingPage = null
      entering = true
      onPageRef.current?.(direction)
      apply(1, direction * width(), 0)
      if (prefersReducedMotion()) {
        apply(1, 0, 0)
        entering = false
        return
      }
      panX.to(0)
    }

    const settlePage = (): void => {
      const w = width()
      const v = velocityFrom(historyX)
      // Куда кадр доехал бы сам (§6): маленький резкий флик листает, долгое вялое
      // перетаскивание на ту же дистанцию — нет.
      const projected = px + projectMomentum(v)
      const direction: 1 | -1 | 0 =
        projected <= -w * PAGE_FRACTION ? 1 : projected >= w * PAGE_FRACTION ? -1 : 0

      if (direction !== 0 && canGo(direction)) {
        pendingPage = direction
        if (prefersReducedMotion()) {
          finishPage()
          return
        }
        tunePan(true)
        panX.to(-direction * w, v)
        return
      }
      if (prefersReducedMotion()) {
        apply(1, 0, 0)
        return
      }
      // Не долистали — кадр возвращается на место своим обычным, мягким ходом.
      tunePan(false)
      panX.to(0, v)
    }

    const settleZoom = (): void => {
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
      tunePan(false)
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
      tunePan(false)
      panX.to(x)
      panY.to(y)
    }

    /** Тап по снимку: второй подряд — приблизить/вернуть. Тап по пустому полю не наш. */
    const onTap = (e: PointerEvent): void => {
      const el = content.current
      if (!el || zoomDisabled) return
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
      if (!moved) {
        onTap(e)
        return
      }
      if (mode === 'page') settlePage()
      else if (mode === 'zoom') settleZoom()
    }

    // Жест не должен превращаться в клик: иначе отпускание после листания или
    // панорамирования закрывало бы просмотрщик (клик по фону = закрыть).
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
      if (entering) return
      points.clear()
      mode = 'idle'
      moved = false
      pinched = false
      swallowClick = false
      pendingPage = null
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
  }, [content, zoomDisabled, maxScale])

  const reset = useCallback((): void => resetRef.current(), [])

  return useMemo(() => ({ surfaceRef, layerRef, reset }), [reset])
}
