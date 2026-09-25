'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Inbox,
} from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useMediaQuery } from '../../../shared/lib'
import { formatYmd, monthCells, sameDay } from '../../../shared/ui/calendar-grid'
import { scheduleKeys, fetchSchedule, fetchScheduleChanges } from '../../../entities/schedule'
import { eventKeys, fetchEvents } from '../../../entities/event'
import { assignmentKeys, fetchAssignments } from '../../../entities/assignment'
import type { Holiday } from '../../../shared/config'
import {
  buildCalendar,
  groupByDate,
  holidaysByDate,
  type CalFilter,
  type CalItem,
} from '../lib/calendar-events'

// Единый академический календарь: пары + события в одном месте. Desktop — Месяц,
// mobile — Повестка (задача 26). Фильтр Все/Пары/События.
export function CalendarView() {
  const t = useTranslations('Calendar')
  const locale = useLocale()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const [anchor, setAnchor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [view, setView] = useState<'month' | 'agenda'>('month')
  const [filter, setFilter] = useState<CalFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const cells = useMemo(() => monthCells(anchor.getFullYear(), anchor.getMonth()), [anchor])
  const rangeFrom = formatYmd(cells[0] ?? anchor)
  const rangeTo = formatYmd(cells[cells.length - 1] ?? anchor)

  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const changes = useQuery({
    queryKey: scheduleKeys.changes({ from: rangeFrom, to: rangeTo }),
    queryFn: () => fetchScheduleChanges({ from: rangeFrom, to: rangeTo }),
    enabled: !!schedule.data,
  })
  const events = useQuery({
    queryKey: eventKeys.list('upcoming'),
    queryFn: () => fetchEvents({ limit: 50, filter: 'upcoming' }),
  })
  const assignments = useQuery({
    queryKey: assignmentKeys.list(),
    queryFn: () => fetchAssignments(),
    retry: false,
  })

  const byDate = useMemo(() => {
    const items = buildCalendar(
      schedule.data?.pairs ?? [],
      changes.data ?? [],
      events.data ?? [],
      assignments.data ?? [],
      cells,
      filter,
    )
    return groupByDate(items)
  }, [schedule.data, changes.data, events.data, assignments.data, cells, filter])

  // Праздники месяца — из справочника, без запроса: он уже в бандле (shared/config/holidays.ts).
  const holidays = useMemo(() => holidaysByDate(cells), [cells])

  const weekdayLabels = useMemo(
    // 1 января 2024 — понедельник, поэтому ряд получается Пн..Вс (локализованный).
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }),
      ),
    [locale],
  )

  const monthTitle = anchor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const today = new Date()

  const effectiveView = isDesktop ? view : 'agenda'

  function shiftMonth(delta: number) {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1))
    setSelected(null)
  }

  const isLoading = schedule.isLoading || events.isLoading

  // Без `min-h-0`: экран прокручивается целиком, внутреннего скролл-контейнера тут нет.
  // С `min-h-0` колонка ужималась до высоты `main`, а карточки с `overflow-hidden`
  // резали содержимое — оно уходило за нижнюю границу без всякой прокрутки.
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          <div className="w-40">
            <Select value={filter} onValueChange={(v) => setFilter(v as CalFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filter.all')}</SelectItem>
                <SelectItem value="pair">{t('filter.pairs')}</SelectItem>
                <SelectItem value="assignment">{t('filter.assignments')}</SelectItem>
                <SelectItem value="event">{t('filter.events')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="lg"
            icon
            onClick={() => shiftMonth(-1)}
            aria-label={t('prev')}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="lg"
            icon
            onClick={() => shiftMonth(1)}
            aria-label={t('next')}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <span className="ml-2 font-heading text-base font-semibold capitalize">{monthTitle}</span>
        </div>
        {isDesktop && (
          <Tabs value={view} onValueChange={(v) => setView(v as 'month' | 'agenda')}>
            <TabsList>
              <TabsTrigger value="month">{t('view.month')}</TabsTrigger>
              <TabsTrigger value="agenda">{t('view.agenda')}</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : effectiveView === 'month' ? (
        <MonthGrid
          cells={cells}
          anchorMonth={anchor.getMonth()}
          today={today}
          byDate={byDate}
          holidays={holidays}
          weekdayLabels={weekdayLabels}
          selected={selected}
          onSelect={(ds) => setSelected(ds)}
          t={t}
        />
      ) : (
        <Agenda
          cells={cells}
          byDate={byDate}
          holidays={holidays}
          locale={locale}
          selected={selected}
          t={t}
        />
      )}

      {/* День выбранной даты — окном, а не панелью под сеткой. Панель появлялась ниже
          календаря: на экране, где сетка месяца занимает высоту целиком, её не было
          видно, и выбор даты выглядел как «ничего не произошло». Окно показывает день
          сразу и не двигает сетку.

          Закрытие сбрасывает выбор: `selected` заодно фильтрует повестку, и день,
          оставшийся выбранным после закрытия, показал бы в ней одну строку вместо месяца. */}
      {selected && (
        <Modal onClose={() => setSelected(null)} title={dayTitle(selected, locale)} size="lg">
          <DayList
            date={selected}
            items={byDate.get(selected) ?? []}
            holiday={holidays.get(selected) ?? null}
            locale={locale}
            t={t}
          />
        </Modal>
      )}
    </div>
  )
}

type T = ReturnType<typeof useTranslations>

const TYPE_ACCENT = {
  pairNormal: 'border-l-primary bg-primary/10 text-foreground',
  pairChanged: 'border-l-warning bg-warning/10 text-foreground',
  pairCancelled: 'border-l-destructive bg-destructive/10 text-muted-foreground line-through',
  event: 'border-l-info bg-info/10 text-foreground',
  assignment: 'border-l-warning bg-warning/10 text-foreground',
}

function itemAccent(it: CalItem): string {
  if (it.type === 'event') return TYPE_ACCENT.event
  if (it.type === 'assignment') return TYPE_ACCENT.assignment
  if (it.cancelled) return TYPE_ACCENT.pairCancelled
  if (it.changed) return TYPE_ACCENT.pairChanged
  return TYPE_ACCENT.pairNormal
}

function MonthGrid({
  cells,
  anchorMonth,
  today,
  byDate,
  holidays,
  weekdayLabels,
  selected,
  onSelect,
  t,
}: {
  cells: Date[]
  anchorMonth: number
  today: Date
  byDate: Map<string, CalItem[]>
  holidays: Map<string, Holiday>
  weekdayLabels: string[]
  selected: string | null
  onSelect: (ds: string) => void
  t: T
}) {
  const tSeason = useTranslations('Season')

  return (
    // Сетка занимает всю свободную высоту, а не высоту содержимого: иначе под
    // календарём оставался пустой хвост, и снизу воздуха было заметно больше, чем
    // сверху, хотя отступы `main` одинаковые.
    //
    // `min-h-0` при этом НЕ нужен ни здесь, ни у корня страницы (§4): корень тянется
    // `flex-1`, пока содержимое короче окна, и перестаёт, когда длиннее. Строки
    // делят высоту поровну, но не уже 6rem — на низком окне сетка не сплющится в
    // полоски, а честно уедет в прокрутку.
    <Card className="flex flex-1 flex-col">
      <CardContent className="flex min-w-0 flex-1 flex-col p-0">
        <div className="grid shrink-0 grid-cols-7 border-b border-border text-center text-xs font-medium text-muted-foreground">
          {weekdayLabels.map((w) => (
            <div key={w} className="py-2 capitalize">
              {w}
            </div>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-[minmax(6rem,1fr)] grid-cols-7">
          {cells.map((d) => {
            const ds = formatYmd(d)
            const items = byDate.get(ds) ?? []
            const holiday = holidays.get(ds) ?? null
            // Плашка праздника занимает строку клетки, поэтому событий влезает на одно
            // меньше: иначе день с праздником и тремя парами выходил за высоту ряда.
            const limit = holiday ? 2 : 3
            const outside = d.getMonth() !== anchorMonth
            const isToday = sameDay(d, today)
            const isSel = selected === ds
            return (
              <button
                key={ds}
                type="button"
                onClick={() => onSelect(ds)}
                className={cn(
                  // Минимум высоты задаёт дорожка строки (`auto-rows`), не клетка:
                  // два источника расходились бы при правке.
                  'flex flex-col gap-1 border-r border-b border-border p-1.5 text-left align-top last:border-r-0 focus-visible:z-10 focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
                  outside && 'bg-muted/30',
                  isSel && 'bg-primary/[0.06]',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                    outside ? 'text-muted-foreground/60' : 'text-foreground',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {d.getDate()}
                </span>
                <span className="flex flex-col gap-0.5">
                  {/* Праздник — контекст дня, а не событие: нейтральная плашка, чтобы он
                      не спорил с цветными полосками пар, дедлайнов и событий. */}
                  {holiday && (
                    <span className="truncate rounded bg-muted px-1 py-0.5 text-[11px] leading-tight text-muted-foreground">
                      {tSeason(`${holiday.id}.name`)}
                    </span>
                  )}
                  {items.slice(0, limit).map((it) => (
                    <span
                      key={it.id}
                      className={cn(
                        'truncate rounded border-l-2 px-1 py-0.5 text-[11px] leading-tight',
                        itemAccent(it),
                      )}
                    >
                      {it.start ? `${it.start} ` : ''}
                      {it.title}
                    </span>
                  ))}
                  {items.length > limit && (
                    <span className="px-1 text-[11px] text-muted-foreground">
                      {t('more', { count: items.length - limit })}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function Agenda({
  cells,
  byDate,
  holidays,
  locale,
  selected,
  t,
}: {
  cells: Date[]
  byDate: Map<string, CalItem[]>
  holidays: Map<string, Holiday>
  locale: string
  selected: string | null
  t: T
}) {
  const days = cells
    .map((d) => formatYmd(d))
    // День с праздником попадает в повестку и без пар: 16 декабря «ничего не
    // запланировано» — неверный ответ, в этот день не учатся.
    .filter((ds, i, arr) => arr.indexOf(ds) === i)
    .filter((ds) => (byDate.get(ds)?.length ?? 0) > 0 || holidays.has(ds))
    .filter((ds) => (selected ? ds === selected : true))

  if (days.length === 0) {
    return <EmptyState icon={<Inbox />} title={t('empty')} description={t('emptyHint')} />
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map((ds) => (
        <Card key={ds}>
          <CardContent className="p-4">
            <DayList
              date={ds}
              items={byDate.get(ds) ?? []}
              holiday={holidays.get(ds) ?? null}
              locale={locale}
              t={t}
              showDateHeader
            />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Подпись дня: «среда, 23 сентября». Одна на заголовок окна и на шапку списка. */
function dayTitle(date: string, locale: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function DayList({
  date,
  items,
  holiday,
  locale,
  t,
  showDateHeader,
}: {
  date: string
  items: CalItem[]
  holiday: Holiday | null
  locale: string
  t: T
  showDateHeader?: boolean
}) {
  const tSeason = useTranslations('Season')
  const label = dayTitle(date, locale)
  return (
    <div className="flex flex-col gap-2">
      {showDateHeader && (
        <h3 className="font-heading text-sm font-semibold capitalize text-muted-foreground">
          {label}
        </h3>
      )}
      {holiday && (
        <p className="rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{tSeason(`${holiday.id}.name`)}</span>
          {holiday.dayOff && <span> · {t('dayOff')}</span>}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState title={t('noItems')} className="border-0 p-6" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li key={it.id}>
              <Link
                href={it.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-l-4 border-border p-2.5 transition-colors hover:bg-muted/40',
                  itemAccent(it),
                )}
              >
                <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {it.start ?? '—'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {it.type === 'event' ? (
                      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                    ) : it.type === 'assignment' ? (
                      <ClipboardList className="size-3.5 shrink-0" aria-hidden />
                    ) : (
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                    )}
                    {it.title}
                  </span>
                  {it.subtitle && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {it.subtitle}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
