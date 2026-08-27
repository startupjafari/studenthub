'use client'

import { useMemo, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarClock, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { CalendarNav } from './calendar-nav'

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// Значение хранится в формате datetime-local: "YYYY-MM-DDTHH:mm".
function parse(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  return Number.isNaN(dt.getTime()) ? null : dt
}
function format(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Поле даты-времени с календарём: при нажатии открывается поповер с выбором конкретной
// даты (сетка месяца) и времени. Без внешних зависимостей (новая зависимость = стоп-точка);
// на Radix Popover — корректно работает внутри модалок (как Select).
export function DateTimePicker({
  value,
  onChange,
  min,
  disabled,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
}: {
  value: string
  onChange: (value: string) => void
  min?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  /** Поле с ошибкой: рамка и кольцо становятся красными (DESIGN_SYSTEM §8). */
  'aria-invalid'?: boolean
}) {
  const t = useTranslations('DatePicker')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const selected = parse(value)
  const minDate = min ? parse(min) : null

  // Видимый месяц календаря (инициализируется выбранной датой или текущим месяцем).
  const [view, setView] = useState(() => selected ?? new Date())
  const year = view.getFullYear()
  const month = view.getMonth()

  // Названия дней недели (Пн→Вс) и подпись месяца — из локали, без словарей.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    // 2021-08-02 — понедельник.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2021, 7, 2 + i)))
  }, [locale])
  const label = selected
    ? new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(selected)
    : t('placeholder')

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Пн = 0
  const cells = Array.from({ length: 42 }, (_, i) => new Date(year, month, i - firstWeekday + 1))
  const today = new Date()

  function pickDay(day: Date): void {
    const base = selected ?? new Date()
    onChange(
      format(
        new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          base.getHours(),
          base.getMinutes(),
        ),
      ),
    )
    setView(new Date(day.getFullYear(), day.getMonth(), 1))
  }
  function pickTime(hhmm: string): void {
    const [hh, mm] = hhmm.split(':').map(Number)
    const base = selected ?? new Date()
    onChange(
      format(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh || 0, mm || 0)),
    )
  }
  function pickNow(): void {
    const now = new Date()
    onChange(format(now))
    setView(new Date(now.getFullYear(), now.getMonth(), 1))
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-background pl-3 pr-9 text-left text-sm outline-none transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-4 aria-invalid:ring-destructive/15 dark:bg-input/30"
          >
            <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            {/* Заголовок месяца + навигация */}
            <CalendarNav view={view} onViewChange={setView} minDate={minDate}>
              {/* Дни недели */}
              <div className="grid grid-cols-7">
                {weekdays.map((w, i) => (
                  <span
                    key={i}
                    className="flex h-7 items-center justify-center text-xs font-medium capitalize text-muted-foreground"
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* Сетка дней */}
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((d, i) => {
                  const inMonth = d.getMonth() === month
                  const isSel = selected !== null && sameDay(d, selected)
                  const isToday = sameDay(d, today)
                  const isDisabled = minDate !== null && dayStart(d) < dayStart(minDate)
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => pickDay(d)}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg text-sm transition-colors',
                        !inMonth && 'text-muted-foreground/40',
                        isSel ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
                        isToday && !isSel && 'ring-1 ring-inset ring-primary/40',
                        isDisabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                      )}
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
            </CalendarNav>

            {/* Время + действия */}
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <input
                type="time"
                value={selected ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}` : ''}
                onChange={(e) => pickTime(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 dark:bg-input/30"
              />
              <button
                type="button"
                onClick={pickNow}
                className="h-9 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {t('now')}
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
