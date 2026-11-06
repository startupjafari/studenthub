'use client'

import { useRef, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { RotateCcwSquare, TrianglesCenterlineDashedVertical } from 'lucide-react'
import { cn } from '../lib/utils'

/** Точная подстройка угла, как в Telegram: ±90°, шаг — градус. */
const MAX_ANGLE = 90
/** Пикселей линейки на градус. */
const PX_PER_DEG = 6

/** Круглая кнопка панели на тёмной сцене редактора. */
export const CROP_TOOL_BUTTON =
  'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-40'

/**
 * Панель кадрирования под сценой: поворот на 90° · линейка точного угла · отражение.
 * Общая для окна кадрирования (ImageCropModal) и редактора сторис; `children` — свои
 * кнопки редактора справа от отражения.
 */
export function CropToolbar({
  angle,
  flip,
  disabled,
  onRotate,
  onAngle,
  onFlip,
  onRulerStart,
  onRulerEnd,
  children,
  className,
}: {
  angle: number
  flip: boolean
  disabled?: boolean
  onRotate: () => void
  onAngle: (deg: number) => void
  onFlip: () => void
  onRulerStart: () => void
  onRulerEnd: () => void
  children?: ReactNode
  className?: string
}) {
  const t = useTranslations('Profile')
  return (
    <div className={cn('mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-3', className)}>
      <button
        type="button"
        aria-label={t('rotate')}
        title={t('rotate')}
        onClick={onRotate}
        disabled={disabled}
        className={cn(CROP_TOOL_BUTTON, 'text-white/80 hover:text-white')}
      >
        <RotateCcwSquare className="size-5" aria-hidden />
      </button>
      <AngleRuler
        value={angle}
        label={t('cropAngle')}
        disabled={disabled}
        onStart={onRulerStart}
        onEnd={onRulerEnd}
        onChange={onAngle}
      />
      <button
        type="button"
        aria-label={t('cropFlip')}
        title={t('cropFlip')}
        aria-pressed={flip}
        onClick={onFlip}
        disabled={disabled}
        className={cn(CROP_TOOL_BUTTON, flip ? 'text-primary' : 'text-white/80 hover:text-white')}
      >
        {/* Отражение по горизонтали: треугольники слева и справа от вертикальной оси.
            В lucide 1.x имя FlipHorizontal2 указывает на другой рисунок (ось горизонтальная). */}
        <TrianglesCenterlineDashedVertical className="size-5" aria-hidden />
      </button>
      {children}
    </div>
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
