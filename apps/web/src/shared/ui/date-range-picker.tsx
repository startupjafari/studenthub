'use client'

import { useMemo, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { FIELD_SIZE, type ControlSize } from './control-size'
import { dayStart, formatYmd, monthCells, parseYmd, sameDay } from './calendar-grid'

// Период: обе границы — "YYYY-MM-DD" ('' если не заданы).
export interface DateRange {
  from: string
  to: string
}

export interface DateRangePickerProps {
  value: DateRange
  onChange: (value: DateRange) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  placeholder?: string
  'aria-label'?: string
}

// Кастомный выбор периода дат: два клика (начало → конец) на сетке месяца, подсветка диапазона
// и превью при наведении. Без внешних зависимостей; на Radix Popover.
export function DateRangePicker({
  size = 'lg',
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  placeholder,
  'aria-label': ariaLabel,
}: DateRangePickerProps & { size?: ControlSize }) {
  const t = useTranslations('DatePicker')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<Date | null>(null)

  const from = parseYmd(value.from)
  const to = parseYmd(value.to)
  const minDate = parseYmd(min)
  const maxDate = parseYmd(max)

  const [view, setView] = useState(() => from ?? new Date())
  const year = view.getFullYear()
  const month = view.getMonth()

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2021, 7, 2 + i)))
  }, [locale])
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1),
  )
  const fmtShort = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [locale],
  )
  const label =
    from && to
      ? `${fmtShort.format(from)} — ${fmtShort.format(to)}`
      : from
        ? `${fmtShort.format(from)} — …`
        : (placeholder ?? t('rangePlaceholder'))

  const cells = monthCells(year, month)
  const today = new Date()

  function isOutOfRange(d: Date): boolean {
    if (minDate && dayStart(d) < dayStart(minDate)) return true
    if (maxDate && dayStart(d) > dayStart(maxDate)) return true
    return false
  }

  function pick(d: Date): void {
    // Нет начала, либо период уже полный → начинаем новый диапазон.
    if (!from || (from && to)) {
      onChange({ from: formatYmd(d), to: '' })
      return
    }
    // Есть только начало: клик раньше начала — перезапуск; иначе — закрываем период.
    if (dayStart(d) < dayStart(from)) {
      onChange({ from: formatYmd(d), to: '' })
    } else {
      onChange({ from: value.from, to: formatYmd(d) })
    }
  }

  // Конец диапазона для подсветки: выбранный `to` либо превью под курсором (когда выбран только `from`).
  const previewEnd = to ?? (from && hover ? hover : null)
  const lo =
    from && previewEnd ? (dayStart(from) <= dayStart(previewEnd) ? from : previewEnd) : from
  const hi =
    from && previewEnd ? (dayStart(from) <= dayStart(previewEnd) ? previewEnd : from) : null

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setHover(null)
      }}
    >
      <div className={cn('relative', className)}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl border border-input bg-background pr-9 pl-3 text-left outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50 dark:bg-input/30',
              FIELD_SIZE[size],
            )}
          >
            <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn('truncate', !from && 'text-muted-foreground')}>{label}</span>
          </button>
        </PopoverPrimitive.Trigger>
        {(from || to) && !disabled && (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={(e) => {
              e.stopPropagation()
              onChange({ from: '', to: '' })
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

            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((d, i) => {
                const inMonth = d.getMonth() === month
                const isDisabled = isOutOfRange(d)
                const isStart = lo != null && sameDay(d, lo)
                const isEnd = hi != null && sameDay(d, hi)
                const isEndpoint = isStart || isEnd
                const inBand =
                  lo != null &&
                  hi != null &&
                  dayStart(d) >= dayStart(lo) &&
                  dayStart(d) <= dayStart(hi)
                const isToday = sameDay(d, today)
                return (
                  <div
                    key={i}
                    className={cn(
                      // Заливка-«лента» диапазона живёт на обёртке, чтобы соединять ячейки без зазоров.
                      inBand && 'bg-primary/15',
                      inBand && isStart && 'rounded-l-lg',
                      inBand && isEnd && 'rounded-r-lg',
                    )}
                  >
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => pick(d)}
                      onMouseEnter={() => setHover(d)}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg text-sm transition-colors',
                        !inMonth && 'text-muted-foreground/40',
                        isEndpoint
                          ? 'bg-primary font-medium text-primary-foreground'
                          : 'hover:bg-muted',
                        isToday && !isEndpoint && 'ring-1 ring-primary/40 ring-inset',
                        isDisabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                      )}
                    >
                      {d.getDate()}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="mt-3 flex items-center border-t border-border pt-3">
              <button
                type="button"
                onClick={() => onChange({ from: '', to: '' })}
                className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('clear')}
              </button>
              <button
                type="button"
                disabled={!from || !to}
                onClick={() => setOpen(false)}
                className="ml-auto h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
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
