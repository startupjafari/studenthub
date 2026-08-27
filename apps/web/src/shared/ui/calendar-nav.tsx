'use client'

import { useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'

// Сетка выбора месяца и года — 3 колонки; 12 месяцев и 12 лет ложатся в 4 строки.
const YEARS_PER_PAGE = 12

type Mode = 'days' | 'months' | 'years'

interface CalendarNavProps {
  /** Первое число отображаемого месяца. */
  view: Date
  onViewChange: (next: Date) => void
  minDate?: Date | null
  maxDate?: Date | null
  /** Сетка дней — показывается, пока выбирают день. */
  children: ReactNode
}

/**
 * Шапка календаря с быстрым выбором месяца и года.
 *
 * Раньше между месяцами можно было только листать стрелками: чтобы добраться до даты
 * рождения или до диплома десятилетней давности, требовались десятки кликов. Теперь
 * заголовок — кнопка: «Май 2023 г.» открывает месяцы года, «2023» — страницу из 12 лет.
 *
 * Общая для DatePicker, DateRangePicker и DateTimePicker — шапка у них была одинаковой,
 * и три копии этой логики разъехались бы при первой же правке.
 */
export function CalendarNav({ view, onViewChange, minDate, maxDate, children }: CalendarNavProps) {
  const t = useTranslations('DatePicker')
  const locale = useLocale()
  const [mode, setMode] = useState<Mode>('days')

  const year = view.getFullYear()
  const month = view.getMonth()
  // Страница лет выравнена по началу двенадцатилетия — при листании годы не «плывут».
  const pageStart = Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE

  const monthNames = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2021, m, 1)),
  )

  const label =
    mode === 'days'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
          new Date(year, month, 1),
        )
      : mode === 'months'
        ? String(year)
        : `${pageStart} — ${pageStart + YEARS_PER_PAGE - 1}`

  function step(dir: -1 | 1): void {
    if (mode === 'days') onViewChange(new Date(year, month + dir, 1))
    else if (mode === 'months') onViewChange(new Date(year + dir, month, 1))
    else onViewChange(new Date(year + dir * YEARS_PER_PAGE, month, 1))
  }

  // Месяц/год целиком вне допустимого диапазона выбрать нельзя — иначе клик приводил бы
  // к пустому месяцу, где все дни заблокированы.
  const monthDisabled = (m: number): boolean =>
    (minDate != null && new Date(year, m + 1, 0) < minDate) ||
    (maxDate != null && new Date(year, m, 1) > maxDate)
  const yearDisabled = (y: number): boolean =>
    (minDate != null && new Date(y, 11, 31) < minDate) ||
    (maxDate != null && new Date(y, 0, 1) > maxDate)

  const cell =
    'flex items-center justify-center rounded-lg text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'
  // Сетка месяцев/годов кладётся поверх области дней и растягивается по ней.
  const overlay = 'absolute inset-0 grid grid-cols-3 grid-rows-4 gap-1'

  return (
    <>
      <div className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          aria-label={mode === 'days' ? t('prevMonth') : t('prevPage')}
          onClick={() => step(-1)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        {/* Заголовок — кнопка на следующий уровень: дни → месяцы → годы. */}
        <button
          type="button"
          aria-label={mode === 'days' ? t('selectMonth') : t('selectYear')}
          onClick={() => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'days')}
          className="rounded-lg px-2 py-1 text-sm font-medium capitalize transition-colors hover:bg-muted"
        >
          {label}
        </button>
        <button
          type="button"
          aria-label={mode === 'days' ? t('nextMonth') : t('nextPage')}
          onClick={() => step(1)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      {/*
        Сетка дней остаётся в разметке всегда и лишь скрывается (`invisible` — это
        visibility, а не display): именно она держит размер попапа. Иначе при переходе
        к месяцам и годам панель прыгала — 3 колонки против 7 и 4 строки против шести.
        Месяцы и годы кладутся поверх той же области и растягиваются по ней.
      */}
      <div className="relative">
        <div className={cn(mode !== 'days' && 'invisible')}>{children}</div>

        {mode === 'months' && (
          <div className={overlay}>
            {monthNames.map((name, m) => (
              <button
                key={m}
                type="button"
                disabled={monthDisabled(m)}
                onClick={() => {
                  onViewChange(new Date(year, m, 1))
                  setMode('days')
                }}
                className={cn(
                  cell,
                  'capitalize',
                  m === month && 'bg-primary text-primary-foreground',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {mode === 'years' && (
          <div className={overlay}>
            {Array.from({ length: YEARS_PER_PAGE }, (_, i) => pageStart + i).map((y) => (
              <button
                key={y}
                type="button"
                disabled={yearDisabled(y)}
                onClick={() => {
                  onViewChange(new Date(y, month, 1))
                  setMode('months')
                }}
                className={cn(
                  cell,
                  'tabular-nums',
                  y === year && 'bg-primary text-primary-foreground',
                )}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
