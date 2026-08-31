'use client'

import { useMemo, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays } from 'lucide-react'
import { cn } from '../lib/utils'
import { dayStart, formatYmd, monthCells, parseYmd, sameDay } from './calendar-grid'
import { CalendarNav } from './calendar-nav'

export interface DateJumpPickerProps {
  /** Выбранный день "YYYY-MM-DD" ('' — ничего не выбрано). */
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  className?: string
  'aria-label': string
}

/**
 * Компактный календарь-«перейти к дате» — как в мессенджерах.
 *
 * Отличается от `DatePicker` тем, что дата здесь не заполняет форму, а сразу выполняет
 * действие. Поэтому нет ни поля ввода с текстом даты, ни кнопки «Готово»: клик по числу
 * и есть подтверждение, попап закрывается сам. Триггер — одна иконка, вровень с
 * соседними кнопками панели, а не поле шириной в треть шапки.
 *
 * Дни-кружки, а не скруглённые квадраты: в узкой сетке без границ кружок читается
 * как «одна дата», а не как ячейка таблицы.
 */
export function DateJumpPicker({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  'aria-label': ariaLabel,
}: DateJumpPickerProps) {
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

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
            open && 'bg-muted text-foreground',
            className,
          )}
        >
          <CalendarDays className="size-4" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[110] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <CalendarNav view={view} onViewChange={setView} minDate={minDate} maxDate={maxDate}>
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
                      'flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors',
                      !inMonth && 'text-muted-foreground/40',
                      isSel ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-muted',
                      // Сегодня выделяем цветом, а не рамкой: рамка внутри кружка выглядит
                      // как второй, вложенный кружок.
                      isToday && !isSel && 'font-semibold text-primary',
                      isDisabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                    )}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          </CalendarNav>

          {/* «Сегодня» — единственная кнопка: самый частый прыжок и он же сбрасывает
              заблудившийся календарь обратно к свежим сообщениям. */}
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => {
                const now = new Date()
                if (!isOutOfRange(now)) pick(now)
              }}
              className="h-9 w-full rounded-lg text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              {t('today')}
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
