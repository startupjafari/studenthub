'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CircleCheck, ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  dayStart,
  formatYmd,
  monthCells,
  sameDay,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib'

/**
 * Календарь переписки по клику на дату (как в Telegram): месяц с превью снимков в кружках
 * дней, переход к дате и — по галочке в шапке — выбор дня или промежутка дней, чтобы
 * очистить историю за них. Что делают «перейти» и «очистить», решает чат.
 */
export function ChatCalendarModal({
  initialDay,
  dayThumbs,
  onMonthChange,
  onJump,
  onClear,
  onClose,
}: {
  /** День, на который нажали ("YYYY-MM-DD"): с него календарь и открывается. */
  initialDay: string
  dayThumbs: Record<string, string>
  /** Открыт месяц "YYYY-MM": чат догружает превью этого месяца. */
  onMonthChange: (month: string) => void
  onJump: (ymd: string) => void
  /** Очистить историю за дни включительно; при одном дне from === to. */
  onClear: (from: string, to: string) => void
  onClose: () => void
}) {
  const t = useTranslations('Chats')
  const locale = useLocale()
  const start = useMemo(() => new Date(`${initialDay}T00:00:00`), [initialDay])
  const [view, setView] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1))
  const [selected, setSelected] = useState<Date>(start)
  const [selecting, setSelecting] = useState(false)
  const [range, setRange] = useState<{ from: Date; to: Date | null } | null>(null)
  const year = view.getFullYear()
  const month = view.getMonth()
  const today = dayStart(new Date())

  useEffect(() => {
    onMonthChange(`${year}-${String(month + 1).padStart(2, '0')}`)
  }, [year, month, onMonthChange])

  const monthTitle = useMemo(() => {
    const s = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(view)
    return s.charAt(0).toUpperCase() + s.slice(1)
  }, [locale, view])
  // Понедельник первым: 2 августа 2021 — понедельник.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2021, 7, 2 + i)))
  }, [locale])
  // Сетка — 6 недель; пустые недели в конце отрезаем, как в Telegram: месяц без «хвоста».
  const cells = monthCells(year, month).filter((_, i, all) =>
    all.slice(i - (i % 7), i - (i % 7) + 7).some((d) => d.getMonth() === month),
  )
  const atLatestMonth = year === today.getFullYear() && month === today.getMonth()

  const rangeDays =
    range != null
      ? Math.round(
          (dayStart(range.to ?? range.from).getTime() - dayStart(range.from).getTime()) /
            86_400_000,
        ) + 1
      : 0

  function shift(delta: number): void {
    setView(new Date(year, month + delta, 1))
  }

  /** Первое нажатие — день, второе — конец промежутка; раньше начала — новое начало. */
  function pick(d: Date): void {
    const day = dayStart(d)
    if (!selecting) {
      setSelected(day)
      return
    }
    setRange((prev) => {
      if (!prev || prev.to) return { from: day, to: null }
      return day < prev.from ? { from: day, to: null } : { from: prev.from, to: day }
    })
  }

  function mark(d: Date): 'edge' | 'inner' | null {
    if (!range) return null
    const day = dayStart(d).getTime()
    const from = dayStart(range.from).getTime()
    const to = dayStart(range.to ?? range.from).getTime()
    if (day === from || day === to) return 'edge'
    return day > from && day < to ? 'inner' : null
  }

  const title = selecting
    ? rangeDays > 0
      ? t('daysSelected', { count: rangeDays })
      : t('selectDays')
    : monthTitle

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-sm">
        <div className="flex items-center gap-1 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('close')}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
          <DialogTitle className="min-w-0 flex-1 truncate text-base font-semibold">
            {title}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            role="switch"
            aria-checked={selecting}
            aria-label={t('selectDays')}
            title={t('selectDays')}
            onClick={() => {
              setSelecting((v) => !v)
              setRange(null)
            }}
            className={cn(
              selecting &&
                'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
            )}
          >
            <CircleCheck aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('prevMonth')}
            onClick={() => shift(-1)}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            icon
            aria-label={t('nextMonth')}
            disabled={atLatestMonth}
            onClick={() => shift(1)}
          >
            <ChevronDown aria-hidden />
          </Button>
        </div>

        <div className="border-t border-border px-3 pt-3 pb-2">
          <p className="mb-2 text-center text-sm font-semibold">{monthTitle}</p>
          <div className="grid grid-cols-7">
            {weekdays.map((w, i) => (
              <span
                key={i}
                className={cn(
                  'flex h-8 items-center justify-center text-xs font-semibold uppercase',
                  i >= 5 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === month
              if (!inMonth) return <span key={i} aria-hidden />
              const future = dayStart(d) > today
              const ymd = formatYmd(d)
              const thumb = dayThumbs[ymd]
              const m = selecting ? mark(d) : null
              const isSel = !selecting && sameDay(d, selected)
              const weekend = d.getDay() === 0 || d.getDay() === 6
              // Полоса промежутка — фоном ячейки во всю ширину, как в Telegram: дни
              // читаются одним выделенным отрезком, а не россыпью кружков.
              const col = i % 7
              return (
                <div
                  key={i}
                  className={cn(
                    'flex justify-center',
                    m === 'inner' && 'bg-primary/15',
                    m === 'edge' && range?.to && !sameDay(range.from, range.to) && 'bg-primary/15',
                    m === 'edge' && range && sameDay(d, range.from) && 'rounded-l-full',
                    m === 'edge' && range && sameDay(d, range.to ?? range.from) && 'rounded-r-full',
                    m === 'inner' && col === 0 && 'rounded-l-full',
                    m === 'inner' && col === 6 && 'rounded-r-full',
                  )}
                >
                  <button
                    type="button"
                    disabled={future}
                    aria-pressed={isSel || m === 'edge'}
                    aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d)}
                    onClick={() => pick(d)}
                    className={cn(
                      'relative flex size-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold tabular-nums transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                      isSel && 'bg-primary text-primary-foreground',
                      !isSel && !thumb && 'hover:bg-muted',
                      m === 'edge' && 'ring-2 ring-primary',
                      weekend && !isSel && !thumb && 'text-destructive',
                      future && 'cursor-not-allowed opacity-30 hover:bg-transparent',
                    )}
                  >
                    {/* Превью снимка дня — фоном под числом, приглушённо: число читается. */}
                    {thumb && !isSel && (
                      <>
                        <img
                          src={thumb}
                          alt=""
                          aria-hidden
                          className="absolute inset-0 size-full object-cover"
                        />
                        <span className="absolute inset-0 bg-black/40" aria-hidden />
                      </>
                    )}
                    <span className={cn('relative', thumb && !isSel && 'text-white')}>
                      {d.getDate()}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t border-border p-3">
          {selecting ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="w-full font-semibold text-destructive uppercase hover:bg-destructive/10 hover:text-destructive"
              disabled={!range}
              onClick={() => {
                if (!range) return
                onClear(formatYmd(range.from), formatYmd(range.to ?? range.from))
              }}
            >
              {t('clearHistory')}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full font-semibold uppercase"
              onClick={() => onJump(formatYmd(selected))}
            >
              {t('goToDate')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
