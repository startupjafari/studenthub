'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Check, RotateCw, X, ZoomIn } from 'lucide-react'
import { useBodyScrollLock } from '../lib'
import { Button } from './button'

const MIN_VIEW = 220 // минимальная ширина области кадрирования, px
const MAX_VIEW = 720 // максимальная ширина области кадрирования, px

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
 * Кадрирование изображения перед загрузкой: перетаскивание, масштаб, поворот на 90°,
 * экспорт через canvas. Без внешних зависимостей (новая зависимость = стоп-точка).
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
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // Размер области кадрирования подстраивается под доступное место в укрупнённом окне.
  const [view, setView] = useState({ w: 288, h: 288 / aspect })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useBodyScrollLock()
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
    }
  }, [file])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Вписываем кадр в доступное место с сохранением пропорции: сначала по ширине,
  // и если по высоте не влезает — пересчитываем от высоты.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      let w = Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.floor(r.width)))
      let h = w / aspect
      if (h > r.height) {
        h = Math.max(MIN_VIEW / aspect, Math.floor(r.height))
        w = h * aspect
      }
      setView({ w: Math.floor(w), h: Math.floor(h) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  // «Cover»-вписывание: кадр всегда заполнен изображением, пустых полей по краям не бывает.
  const baseScale = nat ? Math.max(view.w / nat.w, view.h / nat.h) : 1
  const displayScale = baseScale * zoom
  const dispW = nat ? nat.w * displayScale : 0
  const dispH = nat ? nat.h * displayScale : 0

  const clampWith = (x: number, y: number, w: number, h: number) => ({
    x: Math.min(0, Math.max(view.w - w, x)),
    y: Math.min(0, Math.max(view.h - h, y)),
  })
  const clamp = (x: number, y: number) => clampWith(x, y, dispW, dispH)

  // При изменении размера области — пере-центрируем изображение (сохраняя зум).
  useEffect(() => {
    if (!nat) return
    const ds = Math.max(view.w / nat.w, view.h / nat.h) * zoom
    setOffset({ x: (view.w - nat.w * ds) / 2, y: (view.h - nat.h * ds) / 2 })
  }, [view])

  function onLoad() {
    const el = imgRef.current
    if (!el) return
    const w = el.naturalWidth
    const h = el.naturalHeight
    setNat({ w, h })
    const bs = Math.max(view.w / w, view.h / h)
    setOffset({ x: (view.w - w * bs) / 2, y: (view.h - h * bs) / 2 })
    setZoom(1)
  }

  function onZoom(next: number) {
    if (!nat) return
    const oldDS = baseScale * zoom
    const newDS = baseScale * next
    // Приближаем к центру кадра: точка под центром остаётся под центром.
    const ix = (view.w / 2 - offset.x) / oldDS
    const iy = (view.h / 2 - offset.y) / oldDS
    setZoom(next)
    setOffset(
      clampWith(view.w / 2 - ix * newDS, view.h / 2 - iy * newDS, nat.w * newDS, nat.h * newDS),
    )
  }

  function onPointerDown(e: React.PointerEvent) {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    setOffset(clamp(drag.current.ox + dx, drag.current.oy + dy))
  }
  function onPointerUp() {
    drag.current = null
  }

  // Поворот на 90°: перерисовываем текущий кадр в canvas со свопом сторон и делаем его новым источником;
  // onLoad пересчитает масштаб/центрирование. Без внешних зависимостей.
  function rotate90() {
    const el = imgRef.current
    if (!el || !nat) return
    const canvas = document.createElement('canvas')
    canvas.width = nat.h
    canvas.height = nat.w
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(el, -nat.w / 2, -nat.h / 2)
    setUrl(canvas.toDataURL('image/png'))
  }

  function save() {
    const el = imgRef.current
    if (!el || !nat) return
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = Math.round(outputWidth / aspect)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const sx = -offset.x / displayScale
    const sy = -offset.y / displayScale
    ctx.drawImage(
      el,
      sx,
      sy,
      view.w / displayScale,
      view.h / displayScale,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onSave(new File([blob], `${round ? 'avatar' : 'image'}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.9,
    )
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[50vh] max-h-[92vh] min-h-[460px] w-[60vw] min-w-[min(92vw,560px)] flex-col gap-4 rounded-2xl border border-border bg-card p-6 animate-in zoom-in-95 duration-200"
      >
        <div>
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-muted-foreground">{t('cropHint')}</p>
        </div>

        <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center">
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ width: view.w, height: view.h }}
            className={`relative touch-none overflow-hidden border border-border bg-muted ${round ? 'rounded-full' : 'rounded-xl'}`}
          >
            {url && (
              <img
                ref={imgRef}
                src={url}
                alt=""
                onLoad={onLoad}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: offset.x,
                  top: offset.y,
                  width: dispW || undefined,
                  height: dispH || undefined,
                  maxWidth: 'none',
                  cursor: 'grab',
                }}
              />
            )}
            <span
              className={`pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/50 ${round ? 'rounded-full' : 'rounded-xl'}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex flex-1 items-center gap-3">
            <ZoomIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              aria-label={t('zoom')}
              onChange={(e) => onZoom(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            />
          </label>
          <button
            type="button"
            aria-label={t('rotate')}
            title={t('rotate')}
            onClick={rotate90}
            disabled={!nat}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCw className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            disabled={saving}
          >
            <X className="size-4" aria-hidden />
            {t('cancel')}
          </Button>
          <Button type="button" className="flex-1" onClick={save} loading={saving} disabled={!nat}>
            <Check className="size-4" aria-hidden />
            {confirm}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
