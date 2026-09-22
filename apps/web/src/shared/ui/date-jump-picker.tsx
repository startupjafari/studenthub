'use client'

import { useEffect, useMemo, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, CalendarRange, Check } from 'lucide-react'
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
  /**
   * Картинка в кружке дня: `{ "YYYY-MM-DD": url }`. Нужна там, где за днями стоит содержимое,
   * а не просто дата: в календаре переписки миниатюра сразу показывает, что в этот день было
   * отправлено, и выбирать приходится не наугад по числам.
   */
  dayThumbs?: Record<string, string>
  /** Открыт другой месяц: вызывающий догружает то, чем этот месяц наполняется. */
  onViewChange?: (year: number, month: number) => void
  /**
   * Разрешить выбор диапазона. Появляется переключатель режима: в нём нажимают начало и
   * конец, а внизу вместо «Сегодня» встаёт кнопка действия над периодом (`rangeActionLabel`).
   * Что именно делает действие, календарь не знает — это дело вызывающего.
   */
  rangeAction?: {
    label: string
    destructive?: boolean
    onSubmit: (from: string, to: string) => void
  }
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
  dayThumbs,
  onViewChange,
  rangeAction,
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
  // Режим диапазона и его набранные концы. `to === null` — начало поставлено, конца ждём.
  const [ranging, setRanging] = useState(false)
  const [range, setRange] = useState<{ from: Date; to: Date | null } | null>(null)
  const year = view.getFullYear()
  const month = view.getMonth()

  // Месяц сменился (в том числе через выбор года в шапке) — сообщаем наружу. Только при
  // открытом попапе: закрытый календарь ничего не показывает, и грузить его наполнение
  // на каждом смонтированном экране незачем.
  useEffect(() => {
    if (!open) return
    onViewChange?.(year, month)
  }, [open, year, month, onViewChange])

  // Закрыли попап — сбрасываем режим: вернувшись сюда за обычным переходом по дате,
  // человек не должен обнаружить наполовину набранный период с прошлого раза.
  useEffect(() => {
    if (open) return
    setRanging(false)
    setRange(null)
  }, [open])

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
    if (ranging) {
      pickRange(d)
      return
    }
    onChange(formatYmd(d))
    setView(new Date(d.getFullYear(), d.getMonth(), 1))
    setOpen(false)
  }

  /** Первое нажатие ставит начало, второе — конец; нажатие раньше начала переставляет начало. */
  function pickRange(d: Date): void {
    setRange((prev) => {
      if (!prev || prev.to) return { from: dayStart(d), to: null }
      const picked = dayStart(d)
      return picked < prev.from ? { from: picked, to: null } : { from: prev.from, to: picked }
    })
  }

  const rangeDays =
    range && range.to
      ? Math.round((dayStart(range.to).getTime() - dayStart(range.from).getTime()) / 86_400_000) + 1
      : 0

  function inRange(d: Date): 'edge' | 'inner' | null {
    if (!range) return null
    const day = dayStart(d).getTime()
    const from = dayStart(range.from).getTime()
    const to = range.to ? dayStart(range.to).getTime() : from
    if (day === from || day === to) return 'edge'
    return day > from && day < to ? 'inner' : null
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
          <CalendarDays className="size-5" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[110] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Переключатель режима — галочкой в кружке, как в Telegram: место в шапке занято
              месяцем и стрелками, а подпись «выбрать период» его бы распёрла. */}
          {rangeAction && (
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {ranging && rangeDays > 0 ? t('rangeSelected', { count: rangeDays }) : t('range')}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={ranging}
                aria-label={t('range')}
                onClick={() => {
                  setRanging((v) => !v)
                  setRange(null)
                }}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors',
                  ranging
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {ranging ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <CalendarRange className="size-4" aria-hidden />
                )}
              </button>
            </div>
          )}

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
                const isSel = !ranging && selected !== null && sameDay(d, selected)
                const isToday = sameDay(d, today)
                const isDisabled = isOutOfRange(d)
                const mark = ranging ? inRange(d) : null
                const thumb = dayThumbs?.[formatYmd(d)]
                // Выходные помечаем числом, а не заливкой: заливка спорила бы и с выбором,
                // и с миниатюрой, а суббота с воскресеньем нужны только чтобы не
                // пересчитывать недели глазами.
                const weekend = d.getDay() === 0 || d.getDay() === 6
                const filled = isSel || mark === 'edge'
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => pick(d)}
                    className={cn(
                      'relative flex size-9 items-center justify-center overflow-hidden rounded-full text-sm tabular-nums transition-colors',
                      !inMonth && 'text-muted-foreground/40',
                      filled
                        ? 'bg-primary font-medium text-primary-foreground'
                        : mark === 'inner'
                          ? 'bg-primary/15 text-foreground'
                          : 'hover:bg-muted',
                      weekend && !filled && mark === null && inMonth && 'text-destructive',
                      // Сегодня выделяем цветом, а не рамкой: рамка внутри кружка выглядит
                      // как второй, вложенный кружок.
                      isToday && !filled && 'font-semibold text-primary',
                      isDisabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                    )}
                  >
                    {/* Миниатюра — фоном под числом, а не вместо него: день должен
                        оставаться читаемым, поэтому снимок приглушён и затемнён. */}
                    {thumb && !filled && (
                      <>
                        <img
                          src={thumb}
                          alt=""
                          aria-hidden
                          className="absolute inset-0 size-full object-cover opacity-70"
                        />
                        <span className="absolute inset-0 bg-black/35" aria-hidden />
                      </>
                    )}
                    <span
                      className={cn('relative', thumb && !filled && 'font-semibold text-white')}
                    >
                      {d.getDate()}
                    </span>
                  </button>
                )
              })}
            </div>
          </CalendarNav>

          {/* «Сегодня» — единственная кнопка: самый частый прыжок и он же сбрасывает
              заблудившийся календарь обратно к свежим сообщениям. В режиме диапазона её
              место занимает действие над периодом. */}
          <div className="mt-2 border-t border-border pt-2">
            {ranging && rangeAction ? (
              <button
                type="button"
                disabled={!range?.to}
                onClick={() => {
                  if (!range?.to) return
                  rangeAction.onSubmit(formatYmd(range.from), formatYmd(range.to))
                  setOpen(false)
                }}
                className={cn(
                  'h-9 w-full rounded-lg text-sm font-medium transition-colors disabled:opacity-40',
                  rangeAction.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-primary hover:bg-primary/10',
                )}
              >
                {rangeAction.label}
              </button>
            ) : (
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
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
