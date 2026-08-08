'use client'

import { useMemo, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { dayStart, formatYmd, monthCells, parseYmd, sameDay } from './calendar-grid'

export interface DatePickerProps {
  // Значение — "YYYY-MM-DD" ('' если не выбрано).
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  placeholder?: string
  'aria-label'?: string
}

// Кастомный выбор даты (без времени): поповер с сеткой месяца. Без внешних зависимостей
// (новая зависимость = стоп-точка); на Radix Popover — корректно работает внутри модалок.
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const t = useTranslations('DatePicker')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const selected = parseYmd(value)
  const minDate = parseYmd(min)
  const maxDate = parseYmd(max)

  const [view, setView] = useState(() => selected ?? new Date())
  const year = view.getFullYear()
  const month = view.getMonth()

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2021, 7, 2 + i)))
  }, [locale])
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1),
  )
  const label = selected
    ? new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(
        selected,
      )
    : (placeholder ?? t('datePlaceholder'))

  const cells = monthCells(year, month)
  const today = new Date()

  function isOutOfRange(d: Date): boolean {
    if (minDate && dayStart(d) < dayStart(minDate)) return true
    if (maxDate && dayStart(d) > dayStart(maxDate)) return true
    return false
  }
  function pick(d: Date): void {
    onChange(formatYmd(d))
    setView(new Date(d.getFullYear(), d.getMonth(), 1))
    setOpen(false)
  }
  function pickToday(): void {
    const n = new Date()
    if (isOutOfRange(n)) return
    pick(n)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={ariaLabel}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-background pl-3 pr-9 text-left text-sm outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50 dark:bg-input/30"
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>{label}</span>
          </button>
        </PopoverPrimitive.Trigger>
        {selected && !disabled && (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            className="z-[110] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <div className="flex items-center justify-between px-1 pb-2">
              <button
                type="button"
                aria-label={t('prevMonth')}
                onClick={() => setView(new Date(year, month - 1, 1))}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span className="text-sm font-medium capitalize">{monthLabel}</span>
              <button
                type="button"
                aria-label={t('nextMonth')}
                onClick={() => setView(new Date(year, month + 1, 1))}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-7">
              {weekdays.map((w, i) => (
                <span
                  key={i}
                  className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground capitalize"
                >
                  {w}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === month
                const isSel = selected !== null && sameDay(d, selected)
                const isToday = sameDay(d, today)
                const isDisabled = isOutOfRange(d)
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => pick(d)}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-lg text-sm transition-colors',
                      !inMonth && 'text-muted-foreground/40',
                      isSel ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
                      isToday && !isSel && 'ring-1 ring-primary/40 ring-inset',
                      isDisabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                    )}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center border-t border-border pt-3">
              <button
                type="button"
                onClick={pickToday}
                className="h-9 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {t('today')}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t('done')}
              </button>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </div>
    </PopoverPrimitive.Root>
  )
}
