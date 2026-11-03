'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { cn } from '../lib/utils'
import {
  clampPlace,
  coverScale,
  drawPlaced,
  placedTransform,
  rad,
  toStage,
  type Place,
  type Size,
} from '../lib/crop-geometry'
import { useCropGestures } from '../lib/use-crop-gestures'
import { Button } from './button'
import { CropToolbar } from './crop-toolbar'
import { MediaEditorShell } from './media-editor-shell'

/** Отступ рамки от краёв сцены, px: за рамкой видно, что ещё есть на снимке. */
const FRAME_PAD = 32
/** Минимальный размер рамки по короткой стороне, px. */
const MIN_FRAME = 80
/** Во сколько раз можно приблизить сверх «снимок едва закрывает рамку». */
const MAX_ZOOM = 10

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

/**
 * Кадрирование перед загрузкой в раскладке Telegram: снимок во всю сцену, рамка по центру,
 * всё за рамкой притемнено. Снимок двигают и приближают (колесо, щипок), рамку тянут за
 * углы; снизу — поворот на 90°, линейка точного угла и отражение. Экспорт через canvas.
 * Без внешних зависимостей (новая зависимость = стоп-точка).
 *
 * Снимок никогда не открывает пустоту внутри рамки: после любого действия масштаб
 * поднимается до минимального «закрывающего», а смещение зажимается. При повороте
 * на произвольный угол это считается в осях снимка (`shared/lib/crop-geometry`).
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
  const [nat, setNat] = useState<Size | null>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const [frame, setFrame] = useState<Size | null>(null)
  const [place, setPlace] = useState<Place>({ x: 0, y: 0, s: 1 })
  const [quarter, setQuarter] = useState(0)
  const [angle, setAngle] = useState(0)
  const [flip, setFlip] = useState(false)
  // Поворот и отражение — плавно; перетаскивание и зум — без анимации, иначе снимок
  // отставал бы от пальца.
  const [animate, setAnimate] = useState(false)

  const theta = rad(quarter * 90 + angle)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  /** Наименьший масштаб, при котором снимок закрывает рамку при данном повороте. */
  const minScale = useCallback(
    (fw: number, fh: number, th: number): number =>
      nat ? coverScale(nat, { w: fw, h: fh }, th) : 1,
    [nat],
  )

  /** Привести положение к допустимому: снимок закрывает рамку, приближение ограничено. */
  const normalize = useCallback(
    (p: Place, fw: number, fh: number, th: number): Place => {
      if (!nat) return p
      const floor = minScale(fw, fh, th)
      return clampPlace(p, nat, { w: fw, h: fh }, th, floor, floor * MAX_ZOOM)
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

  const { interacting, setInteracting, handlers } = useCropGestures({
    stageRef,
    stage,
    place,
    setPlace,
    normalize: (p) => (frame ? normalize(p, frame.w, frame.h, theta) : p),
    enabled: nat !== null,
    onStart: () => setAnimate(false),
  })

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
    const p = toStage(stageRef.current, e)
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
    drawPlaced(ctx, el, nat, frame.w, place, theta, flip)
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
        {...handlers}
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
                    transform: placedTransform(stage, nat, place, quarter * 90 + angle, flip),
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

      <CropToolbar
        angle={angle}
        flip={flip}
        disabled={!ready}
        onRotate={rotate90}
        onAngle={setAngle}
        onFlip={toggleFlip}
        onRulerStart={() => {
          setAnimate(false)
          setInteracting(true)
        }}
        onRulerEnd={() => setInteracting(false)}
      />
    </MediaEditorShell>
  )
}
