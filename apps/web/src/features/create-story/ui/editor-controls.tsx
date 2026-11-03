'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '../../../shared/lib/utils'

// Контролы правой панели редактора — одна система на все настройки. Сетка 4px:
// 8px между связанными элементами, 12px между контролами секции, 24px между секциями
// (задаёт панель). Высота контролов — 36px, радиусы: 8px у кнопок, 10px у групп
// контролов, 12px у карточек.

/** Секция настроек: подпись и контролы с шагом 12px. */
export function Section({
  title,
  aside,
  children,
}: {
  title: string
  /** Справа от подписи: текущее значение или действие. */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex h-5 items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * Переключатель из равных сегментов: шрифт, выравнивание, подложка, размещение фото.
 * Один выбранный вариант; все кнопки одной ширины и высоты.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T | null
  options: readonly { value: T; label: ReactNode; ariaLabel?: string; className?: string }[]
  onChange: (value: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-[10px] bg-muted/50 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={option.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-8 min-w-0 items-center justify-center rounded-lg px-1 text-xs font-medium transition-colors duration-150 disabled:opacity-50 motion-reduce:transition-none',
              active
                ? 'bg-card text-foreground shadow-sm ring-1 ring-primary/50'
                : 'text-muted-foreground hover:text-foreground',
              option.className,
            )}
          >
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Ползунок с подписью и значением справа: размер, поворот, масштаб фото. */
export function RangeField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  onReset,
  disabled,
}: {
  label: string
  value: number
  /** Значение для глаз: «120%», «−15°». */
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /** Двойной щелчок по ползунку возвращает исходное значение. */
  onReset?: () => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-5 items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <span className="text-xs text-foreground tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
        className="h-5 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
      />
    </div>
  )
}

/** Сетка круглых образцов (цвет текста, фон сторис): одна строка, равный шаг. */
export function SwatchGrid<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null
  options: readonly { value: T; label: string; className?: string; color?: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid justify-between gap-2"
      style={{ gridTemplateColumns: `repeat(${options.length}, 2rem)` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          title={option.label}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'size-8 rounded-full border border-white/15 ring-offset-2 ring-offset-card transition-shadow duration-150 motion-reduce:transition-none',
            option.className,
            option.value === value && 'ring-2 ring-primary',
          )}
          style={option.color ? { backgroundColor: option.color } : undefined}
        />
      ))}
    </div>
  )
}

/** Квадратная кнопка-действие 36px: слои, копия. */
export const ICON_ACTION =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-foreground transition-colors duration-150 hover:bg-muted disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none'
