'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { Check, RotateCw, X, ZoomIn } from 'lucide-react'
import { Button } from '../../../shared/ui'

const OUTPUT = 512 // размер итогового квадрата аватара, px
const MIN_VIEW = 220 // минимальный размер области кадрирования, px
const MAX_VIEW = 560 // максимальный размер области кадрирования, px

interface AvatarCropModalProps {
  file: File
  saving: boolean
  onCancel: () => void
  onSave: (cropped: File) => void
  // Кастомизация для переиспользования (аватар — круг/«Сохранить»; фото профиля — квадрат/«Опубликовать»).
  title?: string
  confirmLabel?: string
  shape?: 'circle' | 'square'
}

// Модалка кадрирования изображения: перетаскивание + масштаб, предпросмотр (круг/квадрат),
// экспорт через canvas. Без внешних зависимостей (новая зависимость = стоп-точка).
export function AvatarCropModal({
  file,
  saving,
  onCancel,
  onSave,
  title,
  confirmLabel,
  shape = 'circle',
}: AvatarCropModalProps) {
  const t = useTranslations('Profile')
  const heading = title ?? t('cropTitle')
  const confirm = confirmLabel ?? t('save')
  const round = shape === 'circle'
  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // Размер области кадрирования подстраивается под доступное место в укрупнённом окне.
  const [view, setView] = useState(288)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      URL.revokeObjectURL(u)
      document.body.style.overflow = prev
    }
  }, [file])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Подгоняем область кадрирования под доступное место (квадрат по меньшей стороне).
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      const size = Math.max(MIN_VIEW, Math.min(MAX_VIEW, Math.floor(Math.min(r.width, r.height))))
      setView(size)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const baseScale = nat ? view / Math.min(nat.w, nat.h) : 1
  const displayScale = baseScale * zoom
  const dispW = nat ? nat.w * displayScale : 0
  const dispH = nat ? nat.h * displayScale : 0

  const clamp = (x: number, y: number) => ({
    x: Math.min(0, Math.max(view - dispW, x)),
    y: Math.min(0, Math.max(view - dispH, y)),
  })

  // При изменении размера области — пере-центрируем изображение (сохраняя зум).
  useEffect(() => {
    if (!nat) return
    const ds = (view / Math.min(nat.w, nat.h)) * zoom
    setOffset({ x: (view - nat.w * ds) / 2, y: (view - nat.h * ds) / 2 })
  }, [view])

  function onLoad() {
    const el = imgRef.current
    if (!el) return
    const w = el.naturalWidth
    const h = el.naturalHeight
    setNat({ w, h })
    const bs = view / Math.min(w, h)
    setOffset({ x: (view - w * bs) / 2, y: (view - h * bs) / 2 })
    setZoom(1)
  }

  function onZoom(next: number) {
    if (!nat) return
    const oldDS = baseScale * zoom
    const newDS = baseScale * next
    const ix = (view / 2 - offset.x) / oldDS
    const iy = (view / 2 - offset.y) / oldDS
    setZoom(next)
    setOffset(clampWith(view / 2 - ix * newDS, view / 2 - iy * newDS, nat.w * newDS, nat.h * newDS))
  }

  // clamp с явными размерами (для зума, где dispW/dispH ещё старые в замыкании).
  function clampWith(x: number, y: number, w: number, h: number) {
    return { x: Math.min(0, Math.max(view - w, x)), y: Math.min(0, Math.max(view - h, y)) }
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
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const sx = -offset.x / displayScale
    const sy = -offset.y / displayScale
    const sSize = view / displayScale
    ctx.drawImage(el, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onSave(new File([blob], `${round ? 'avatar' : 'photo'}.jpg`, { type: 'image/jpeg' }))
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
            style={{ width: view, height: view }}
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
