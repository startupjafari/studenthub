'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, FlipHorizontal2, RotateCcwSquare } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './button'
import { MediaEditorShell } from './media-editor-shell'

/** Отступ рамки от краёв сцены, px: за рамкой видно, что ещё есть на снимке. */
const FRAME_PAD = 32
/** Минимальный размер рамки по короткой стороне, px. */
const MIN_FRAME = 80
/** Во сколько раз можно приблизить сверх «снимок едва закрывает рамку». */
const MAX_ZOOM = 10
/** Точная подстройка угла, как в Telegram: ±90°, шаг — градус. */
const MAX_ANGLE = 90
/** Пикселей линейки на градус. */
const PX_PER_DEG = 6
/** Чувствительность колеса мыши. */
const WHEEL_ZOOM = 0.0015

interface ImageCropModalProps {
  file: File
  saving: boolean
  onCancel: () => void
  onSave: (cropped: File) => void
  // Кастомизация для переиспользования (аватар — круг/«Сохранить»; фото профиля — квадрат/«Опубликовать»).
  title?: string
  confirmLabel?: string
  shape?: 'circle' | 'square'
  /**
   * Соотношение сторон кадра, ширина/высота. 1 — квадрат (аватар, фото профиля),
   * 3 — широкая полоса (обложка). Круглая рамка имеет смысл только при 1.
   */
  aspect?: number
  /** Ширина итогового изображения, px. Высота считается из `aspect`. */
  outputWidth?: number
}

type Pt = { x: number; y: number }
/** Положение снимка: смещение его центра от центра рамки и масштаб. */
type Place = { x: number; y: number; s: number }

const rad = (deg: number): number => (deg * Math.PI) / 180

/** Координаты указателя в системе сцены. */
function toStage(stage: HTMLElement | null, e: { clientX: number; clientY: number }): Pt {
  const r = stage?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

/**
 * Габарит рамки w×h в осях снимка, повёрнутого на θ: сколько снимка нужно по каждой оси,
 * чтобы рамка целиком лежала на нём. Полуширина и полувысота.
 */
function extents(w: number, h: number, theta: number): { ex: number; ey: number } {
  const c = Math.abs(Math.cos(theta))
  const s = Math.abs(Math.sin(theta))
  return { ex: (w * c + h * s) / 2, ey: (w * s + h * c) / 2 }
}

/**
 * Кадрирование перед загрузкой в раскладке Telegram: снимок во всю сцену, рамка по центру,
 * всё за рамкой притемнено. Снимок двигают и приближают (колесо, щипок), рамку тянут за
 * углы; снизу — поворот на 90°, линейка точного угла и отражение. Экспорт через canvas.
 * Без внешних зависимостей (новая зависимость = стоп-точка).
 *
 * Снимок никогда не открывает пустоту внутри рамки: после любого действия масштаб
 * поднимается до минимального «закрывающего», а смещение зажимается. При повороте
 * на произвольный угол это считается в осях снимка (`extents`).
 *
 * Живёт в `shared/ui`, потому что нужен и профилю (аватар, фото, обложка), и панели
 * чата (аватар группы) — а виджет не может импортировать из другого виджета.
 */
export function ImageCropModal({
  file,
  saving,
  onCancel,
  onSave,
  title,
  confirmLabel,
  shape = 'circle',
  aspect = 1,
  outputWidth = 512,
}: ImageCropModalProps) {
  const t = useTranslations('Profile')
  const heading = title ?? t('cropTitle')
  const confirm = confirmLabel ?? t('save')
  // Круглая рамка осмысленна только у квадратного кадра: у полосы она врала бы о результате.
  const round = shape === 'circle' && aspect === 1

  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null)
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)
  const [place, setPlace] = useState<Place>({ x: 0, y: 0, s: 1 })
  const [quarter, setQuarter] = useState(0)
  const [angle, setAngle] = useState(0)
  const [flip, setFlip] = useState(false)
  // Поворот и отражение — плавно; перетаскивание и зум — без анимации, иначе снимок
  // отставал бы от пальца.
  const [animate, setAnimate] = useState(false)
  const [interacting, setInteracting] = useState(false)

  const theta = rad(quarter * 90 + angle)

  // Актуальные значения для обработчиков указателя: те живут дольше одного рендера.
  const live = useRef({ nat, frame, place, theta })
  live.current = { nat, frame, place, theta }

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  /** Наименьший масштаб, при котором снимок закрывает рамку при данном повороте. */
  const minScale = useCallback(
    (fw: number, fh: number, th: number): number => {
      if (!nat) return 1
      const { ex, ey } = extents(fw, fh, th)
      return Math.max((2 * ex) / nat.w, (2 * ey) / nat.h)
    },
    [nat],
  )

  /**
   * Привести положение к допустимому: масштаб не ниже закрывающего, смещение — такое,
   * чтобы рамка не вылезала за снимок. Смещение зажимается в осях повёрнутого снимка.
   */
  const normalize = useCallback(
    (p: Place, fw: number, fh: number, th: number): Place => {
      if (!nat) return p
      const floor = minScale(fw, fh, th)
      const s = Math.min(Math.max(p.s, floor), floor * MAX_ZOOM)
      const cos = Math.cos(th)
      const sin = Math.sin(th)
      // Центр рамки относительно центра снимка — в осях снимка.
      const dx = -p.x
      const dy = -p.y
      let lx = dx * cos + dy * sin
      let ly = -dx * sin + dy * cos
      const { ex, ey } = extents(fw, fh, th)
      const mx = Math.max(0, (nat.w * s) / 2 - ex)
      const my = Math.max(0, (nat.h * s) / 2 - ey)
      lx = Math.min(mx, Math.max(-mx, lx))
      ly = Math.min(my, Math.max(-my, ly))
      return { x: -(lx * cos - ly * sin), y: -(lx * sin + ly * cos), s }
    },
    [nat, minScale],
  )

  /** Самая большая рамка нужной пропорции, что влезает в сцену с отступами. */
  const fitFrame = useCallback(
    (sw: number, sh: number): { w: number; h: number } => {
      const w = Math.max(MIN_FRAME, Math.min(sw - FRAME_PAD * 2, (sh - FRAME_PAD * 2) * aspect))
      return { w, h: w / aspect }
    },
    [aspect],
  )

  // Сцена меняет размер вместе с окном — рамка вписывается заново, снимок остаётся на месте.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r || r.width === 0 || r.height === 0) return
      setStage({ w: r.width, h: r.height })
      setFrame((prev) => {
        const fit = fitFrame(r.width, r.height)
        return prev && prev.w <= fit.w ? prev : fit
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitFrame])

  // Первая раскладка: снимок по центру и ровно закрывает рамку — не больше. Один раз:
  // дальше положение меняют только жесты и инструменты.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || !nat || !frame) return
    placed.current = true
    setPlace({ x: 0, y: 0, s: minScale(frame.w, frame.h, 0) })
  }, [nat, frame, minScale])

  // Рамка или угол изменились — поджимаем положение, чтобы снимок снова закрывал рамку.
  useEffect(() => {
    if (!nat || !frame) return
    setPlace((p) => normalize(p, frame.w, frame.h, theta))
  }, [nat, frame, theta, normalize])

  function onLoad() {
    const el = imgRef.current
    if (!el) return
    setNat({ w: el.naturalWidth, h: el.naturalHeight })
  }

  const local = (e: { clientX: number; clientY: number }): Pt => toStage(stageRef.current, e)

  /**
   * Приблизить в `factor` раз вокруг точки сцены `anchor` (под курсором или между пальцами);
   * `to` — куда эта точка переехала (щипок ещё и сдвигает).
   */
  const zoomAround = useCallback(
    (from: Place, factor: number, anchor: Pt, to: Pt = anchor): Place => {
      const { frame: f, theta: th } = live.current
      if (!f || !stage) return from
      const cx = stage.w / 2 + from.x
      const cy = stage.h / 2 + from.y
      const s = from.s * factor
      const nx = to.x + (cx - anchor.x) * factor - stage.w / 2
      const ny = to.y + (cy - anchor.y) * factor - stage.h / 2
      return normalize({ x: nx, y: ny, s }, f.w, f.h, th)
    },
    [stage, normalize],
  )

  // Колесо — зум под курсором. Слушатель не пассивный: иначе нельзя отменить прокрутку
  // страницы под окном.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setAnimate(false)
      const at = toStage(el, e)
      setPlace((p) => zoomAround(p, Math.exp(-e.deltaY * WHEEL_ZOOM), at))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  // ── Жесты на сцене: один палец/мышь — сдвиг, два пальца — щипок со сдвигом ──
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

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!nat) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    setAnimate(false)
    setInteracting(true)
    beginGesture()
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, local(e))
    const g = gesture.current
    const { frame: f, theta: th } = live.current
    if (!g || !f) return
    if (g.mode === 'pan') {
      const p = pointers.current.get(e.pointerId) as Pt
      setPlace(
        normalize(
          { x: g.from.x + p.x - g.start.x, y: g.from.y + p.y - g.start.y, s: g.from.s },
          f.w,
          f.h,
          th,
        ),
      )
    } else {
      const [a, b] = [...pointers.current.values()] as [Pt, Pt]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      setPlace(zoomAround(g.from, dist / g.dist, g.mid, mid))
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    pointers.current.delete(e.pointerId)
    // Убрали один палец из двух — продолжаем сдвиг оставшимся, без рывка.
    beginGesture()
    if (pointers.current.size === 0) setInteracting(false)
  }

  // ── Углы рамки: тянут рамку, центр остаётся на месте, пропорция — заданная ──
  const resizing = useRef<number | null>(null)

  function onHandleDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizing.current = e.pointerId
    setAnimate(false)
    setInteracting(true)
  }

  function onHandleMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (resizing.current !== e.pointerId || !stage) return
    e.stopPropagation()
    const p = local(e)
    const hw = Math.abs(p.x - stage.w / 2)
    const hh = Math.abs(p.y - stage.h / 2)
    const fit = fitFrame(stage.w, stage.h)
    const minW = aspect >= 1 ? MIN_FRAME * aspect : MIN_FRAME
    const w = Math.min(fit.w, Math.max(minW, 2 * hw, 2 * hh * aspect))
    setFrame({ w, h: w / aspect })
  }

  function onHandleUp(e: React.PointerEvent<HTMLSpanElement>) {
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    resizing.current = null
    setInteracting(false)
  }

  function rotate90() {
    setAnimate(true)
    setQuarter((q) => (q + 3) % 4) // против часовой, как кнопка в Telegram
  }

  function toggleFlip() {
    setAnimate(true)
    setFlip((f) => !f)
  }

  function save() {
    const el = imgRef.current
    if (!el || !nat || !frame) return
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = Math.round(outputWidth / aspect)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    // Та же цепочка, что у CSS-трансформации снимка на экране, только в масштабе
    // итоговой картинки: рамка шириной frame.w превращается в outputWidth.
    const k = canvas.width / frame.w
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.scale(k, k)
    ctx.translate(place.x, place.y)
    ctx.rotate(theta)
    ctx.scale(flip ? -place.s : place.s, place.s)
    ctx.drawImage(el, -nat.w / 2, -nat.h / 2, nat.w, nat.h)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onSave(new File([blob], `${round ? 'avatar' : 'image'}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.9,
    )
  }

  const ready = nat !== null && stage !== null && frame !== null
  const fx = stage && frame ? (stage.w - frame.w) / 2 : 0
  const fy = stage && frame ? (stage.h - frame.h) / 2 : 0

  return (
    <MediaEditorShell
      title={heading}
      hint={t('cropHint')}
      onClose={onCancel}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 text-white hover:bg-white/10 hover:text-white"
            onClick={onCancel}
            disabled={saving}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={save}
            loading={saving}
            disabled={!ready}
          >
            <Check className="size-4" aria-hidden />
            {confirm}
          </Button>
        </>
      }
    >
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'relative min-h-0 flex-1 touch-none overflow-hidden select-none',
          interacting ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        {url && (
          <img
            ref={imgRef}
            src={url}
            alt=""
            onLoad={onLoad}
            draggable={false}
            className={cn(
              'pointer-events-none absolute top-0 left-0 max-w-none origin-center',
              animate && 'transition-transform duration-200 ease-out',
              !ready && 'opacity-0',
            )}
            style={
              nat && stage
                ? {
                    width: nat.w,
                    height: nat.h,
                    transform: `translate(${stage.w / 2 + place.x - nat.w / 2}px, ${
                      stage.h / 2 + place.y - nat.h / 2
                    }px) rotate(${quarter * 90 + angle}deg) scale(${
                      flip ? -place.s : place.s
                    }, ${place.s})`,
                  }
                : undefined
            }
          />
        )}

        {ready && (
          <div
            className="pointer-events-none absolute"
            style={{ left: fx, top: fy, width: frame.w, height: frame.h }}
          >
            {/* Затемнение всего за рамкой — тенью окна-выреза: у круглой рамки тень
                  повторяет скругление, и вырез получается круглым без масок. */}
            <div
              className={cn('absolute inset-0', round ? 'rounded-full' : 'rounded-none')}
              style={{ boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }}
            />
            {/* Сетка третей и тонкая рамка — ярче, пока снимок двигают. */}
            <div
              className={cn(
                'absolute inset-0 border border-white/60 transition-opacity duration-200',
                interacting ? 'opacity-100' : 'opacity-70',
              )}
            >
              <span className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
            </div>
            {/* Углы рамки — за них тянут. Зона нажатия шире видимой точки. */}
            {(
              [
                '-left-3 -top-3',
                '-right-3 -top-3',
                '-left-3 -bottom-3',
                '-right-3 -bottom-3',
              ] as const
            ).map((pos) => (
              <span
                key={pos}
                aria-hidden
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                className={cn(
                  'pointer-events-auto absolute flex size-6 touch-none items-center justify-center',
                  pos.includes('left') === pos.includes('top')
                    ? 'cursor-nwse-resize'
                    : 'cursor-nesw-resize',
                  pos,
                )}
              >
                <span className="size-2.5 rounded-full bg-white shadow" />
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Панель инструментов: поворот на 90° · линейка угла · отражение */}
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-3">
        <button
          type="button"
          aria-label={t('rotate')}
          title={t('rotate')}
          onClick={rotate90}
          disabled={!ready}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <RotateCcwSquare className="size-5" aria-hidden />
        </button>
        <AngleRuler
          value={angle}
          label={t('cropAngle')}
          disabled={!ready}
          onStart={() => {
            setAnimate(false)
            setInteracting(true)
          }}
          onEnd={() => setInteracting(false)}
          onChange={setAngle}
        />
        <button
          type="button"
          aria-label={t('cropFlip')}
          title={t('cropFlip')}
          aria-pressed={flip}
          onClick={toggleFlip}
          disabled={!ready}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-40',
            flip ? 'text-primary' : 'text-white/80 hover:text-white',
          )}
        >
          <FlipHorizontal2 className="size-5" aria-hidden />
        </button>
      </div>
    </MediaEditorShell>
  )
}

/**
 * Линейка точного угла, как в Telegram: шкала ±90° едет под неподвижной меткой по центру.
 * Тянут её пальцем или мышью, стрелками — по градусу; двойной клик возвращает 0°.
 */
function AngleRuler({
  value,
  label,
  disabled,
  onChange,
  onStart,
  onEnd,
}: {
  value: number
  label: string
  disabled?: boolean
  onChange: (deg: number) => void
  onStart: () => void
  onEnd: () => void
}) {
  const drag = useRef<{ x: number; from: number } | null>(null)
  const clampDeg = (d: number): number => Math.round(Math.min(MAX_ANGLE, Math.max(-MAX_ANGLE, d)))

  const ticks: number[] = []
  for (let d = -MAX_ANGLE; d <= MAX_ANGLE; d += 5) ticks.push(d)

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={-MAX_ANGLE}
      aria-valuemax={MAX_ANGLE}
      aria-valuenow={value}
      aria-valuetext={`${value}°`}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, from: value }
        onStart()
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        // Тянут шкалу: сдвиг вправо уводит под метку меньшие значения.
        onChange(clampDeg(d.from - (e.clientX - d.x) / PX_PER_DEG))
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        drag.current = null
        onEnd()
      }}
      onPointerCancel={() => {
        drag.current = null
        onEnd()
      }}
      onDoubleClick={() => !disabled && onChange(0)}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          onChange(clampDeg(value + (e.key === 'ArrowLeft' ? -1 : 1)))
        } else if (e.key === 'Home' || e.key === '0') {
          e.preventDefault()
          onChange(0)
        }
      }}
      className={cn(
        'relative h-12 min-w-0 flex-1 cursor-ew-resize touch-none overflow-hidden rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40',
        disabled && 'pointer-events-none opacity-40',
      )}
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
      }}
    >
      {/* Текущее значение над меткой */}
      <span className="absolute top-0.5 left-1/2 -translate-x-1/2 text-xs font-semibold tabular-nums">
        {value}°
      </span>
      {/* Шкала: 0° стоит под меткой, когда value = 0 */}
      <div
        className="absolute top-5 left-1/2 h-6"
        style={{ transform: `translateX(${-value * PX_PER_DEG}px)` }}
      >
        {ticks.map((d) => {
          const major = d % 15 === 0
          return (
            <span
              key={d}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: d * PX_PER_DEG }}
            >
              <span className={cn('w-px bg-white/40', major ? 'h-2.5 bg-white/70' : 'h-1.5')} />
              {major && d !== 0 && (
                <span className="mt-0.5 text-[9px] text-white/45 tabular-nums">{d}°</span>
              )}
            </span>
          )
        })}
      </div>
      {/* Неподвижная метка по центру */}
      <span className="pointer-events-none absolute top-5 left-1/2 h-4 w-0.5 -translate-x-1/2 rounded-full bg-white" />
    </div>
  )
}
