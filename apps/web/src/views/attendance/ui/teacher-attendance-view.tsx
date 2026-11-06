'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { CalendarDays, ChevronRight } from 'lucide-react'
import {
  Badge,
  Card,
  DatePicker,
  EmptyState,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { isoWeekParity, nowInTz } from '../../../shared/lib'
import {
  scheduleKeys,
  fetchSchedule,
  fetchScheduleChanges,
  isSubstitutedAway,
  substitutionPairs,
  type Pair,
} from '../../../entities/schedule'
import { attendanceKeys, fetchMarkedPairs } from '../../../entities/attendance'
import { useAppSelector } from '../../../shared/store'
import { AttendanceRoster } from './attendance-roster'

// Дисциплина забирает остаток ширины: остальные колонки — короткие и предсказуемые.
const COLS = ['9rem', 'auto', '18%', '11rem', '3.5rem'] as const
// Узкий экран: аудитория скрыта, её доля пересчитана на оставшиеся колонки. Время без
// конца пары (`hidden md:inline` в ячейке) укладывается в 4.5rem.
const COLS_NARROW = ['4.5rem', 'auto', '0', '7.5rem', '2.75rem'] as const
// Аудиторию убираем первой: занятие узнают по времени и дисциплине, а «отмечено ли» —
// главный вопрос экрана, он остаётся на любой ширине.
const HIDE = { room: 'hidden md:table-cell' } as const
const SKELETON_COLS = [undefined, undefined, HIDE.room, undefined, undefined]

// «Посещаемость» преподавателя: выбор даты → занятия этого дня → ростер отметок.
//
// Таблица, а не список карточек: занятий в дне до восьми, и читают их по колонкам —
// во сколько, что, где и отмечено ли. Колонка отметок отвечает на вопрос, ради которого
// на экран и заходят, — какие пары ещё не закрыты.
export function TeacherAttendanceView() {
  const t = useTranslations('Attendance')
  const schedule = useQuery({ queryKey: scheduleKeys.view({}), queryFn: () => fetchSchedule({}) })
  const [date, setDate] = useState(() => nowInTz(null).date)
  const [openPairId, setOpenPairId] = useState<string | null>(null)

  // Замены на выбранный день (C-F12): своё занятие, отданное другому, отмечает заменяющий,
  // а чужое, где заменяющий он сам, в недельной выборке отсутствует — его строим из изменения.
  const myId = useAppSelector((s) => s.auth.user?.id)
  const changesRange = { from: date, to: date }
  const changes = useQuery({
    queryKey: scheduleKeys.changes(changesRange),
    queryFn: () => fetchScheduleChanges(changesRange),
  })
  const substituting = useMemo(
    () => (myId ? substitutionPairs(changes.data ?? [], date, myId) : []),
    [changes.data, date, myId],
  )
  const substitutingIds = useMemo(() => new Set(substituting.map((p) => p.id)), [substituting])

  // Отмены и переносы на выбранный день — как на дашборде (`buildDayPairs`). Отменённое
  // занятие отмечать нечего: сервер откажет и в сохранении, и в QR. У перенесённого —
  // новое время. Решает последнее изменение: они приходят по времени создания.
  const changeByPair = useMemo(() => {
    const out = new Map<string, { cancelled: boolean; start: string; end: string }>()
    for (const c of changes.data ?? []) {
      if (c.date.slice(0, 10) !== date) continue
      const cur = out.get(c.pairId) ?? { cancelled: false, start: '', end: '' }
      if (c.type === 'CANCELLED') cur.cancelled = true
      if (c.type === 'MOVED') {
        cur.start = c.newStartTime ?? ''
        cur.end = c.newEndTime ?? ''
      }
      out.set(c.pairId, cur)
    }
    return out
  }, [changes.data, date])
  const startOf = useCallback(
    (p: Pair) => changeByPair.get(p.id)?.start || p.startTime,
    [changeByPair],
  )
  const endOf = (p: Pair) => changeByPair.get(p.id)?.end || p.endTime
  const isCancelled = (p: Pair) => changeByPair.get(p.id)?.cancelled ?? false

  const dayPairs = useMemo(() => {
    const pairs = schedule.data?.pairs ?? []
    const dayChanges = changes.data ?? []
    const d = new Date(`${date}T00:00:00`)
    const dow = ((d.getDay() + 6) % 7) + 1
    const parity = isoWeekParity(d)
    const own = pairs.filter(
      (p) =>
        p.dayOfWeek === dow &&
        (p.weekType === 'BOTH' || p.weekType === parity) &&
        !(myId && isSubstitutedAway(dayChanges, p.id, date, myId)),
    )
    const ownIds = new Set(own.map((p) => p.id))
    return [...own, ...substituting.filter((p) => !ownIds.has(p.id))].sort((a, b) =>
      startOf(a).localeCompare(startOf(b)),
    )
  }, [schedule.data?.pairs, changes.data, substituting, date, myId, startOf])

  const pairIds = useMemo(() => dayPairs.map((p) => p.id), [dayPairs])
  // Какие пары уже отмечены. Расписание второй раз не запрашиваем — уходят только id
  // уже полученных пар (см. `fetchMarkedPairs`).
  const markedQuery = useQuery({
    queryKey: attendanceKeys.marked(date, pairIds),
    queryFn: () => fetchMarkedPairs(date, pairIds),
    enabled: pairIds.length > 0,
  })
  const markedIds = useMemo(() => new Set(markedQuery.data ?? []), [markedQuery.data])

  // Сортировки по умолчанию нет: занятия уже идут по времени, и стрелка в шапке
  // означала бы порядок, которого никто не выбирал.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<Pair>(dayPairs, (p, key) => {
    if (key === 'time') return startOf(p)
    if (key === 'subject') return p.subject
    if (key === 'room') return p.room?.name ?? null
    if (key === 'state') return isCancelled(p) ? 2 : markedIds.has(p.id) ? 1 : 0
    return null
  })

  // Ранний выход — ПОСЛЕ всех хуков: иначе открытие ростера меняет их число между
  // рендерами, и React бросает исключение (экран уходит в общий error boundary).
  if (openPairId) {
    return <AttendanceRoster pairId={openPairId} date={date} onBack={() => setOpenPairId(null)} />
  }

  return (
    // Сквозная flex-цепочка до таблицы: `fill` требует, чтобы каждый предок отдавал ей
    // высоту, иначе прокручивается страница целиком, а не тело таблицы (§10.7).
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          <div className="w-44">
            <Label className="sr-only">{t('date')}</Label>
            <DatePicker value={date} onChange={(v) => setDate(v)} />
          </div>
        }
      />

      {!schedule.isLoading && dayPairs.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t('noPairs')} description={t('noPairsHint')} />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="time" sort={sort} onSort={toggle}>
                  {t('colTime')}
                </TableHead>
                <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                  {t('colSubject')}
                </TableHead>
                <TableHead sortKey="room" sort={sort} onSort={toggle} className={HIDE.room}>
                  {t('colRoom')}
                </TableHead>
                <TableHead sortKey="state" sort={sort} onSort={toggle}>
                  {t('colState')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('open')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {sorted.map((p) => {
                const cancelled = isCancelled(p)
                return (
                  <TableRow
                    key={p.id}
                    onClick={cancelled ? undefined : () => setOpenPairId(p.id)}
                    className={cancelled ? 'opacity-60' : 'cursor-pointer hover:bg-muted/40'}
                  >
                    <TableCell
                      className={cn(
                        'tabular-nums text-muted-foreground',
                        cancelled && 'line-through',
                      )}
                    >
                      {startOf(p)}
                      {/* Конец пары — уточнение: до `md` колонка под него не растягивается. */}
                      <span className="hidden md:inline"> – {endOf(p)}</span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {substitutingIds.has(p.id) ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <TableText value={p.subject} className="min-w-0" />
                          <Badge variant="secondary" className="shrink-0">
                            {t('substitution')}
                          </Badge>
                        </span>
                      ) : (
                        <TableText value={p.subject} />
                      )}
                    </TableCell>
                    <TableCell className={cn(HIDE.room, 'text-muted-foreground')}>
                      {p.room ? <TableText value={p.room.name} /> : <TableEmpty />}
                    </TableCell>
                    <TableCell>
                      {cancelled ? (
                        <Badge variant="secondary" className="max-w-full truncate">
                          {t('cancelled')}
                        </Badge>
                      ) : (
                        <Badge
                          variant={markedIds.has(p.id) ? 'success' : 'outline'}
                          className="max-w-full truncate"
                        >
                          {markedIds.has(p.id) ? t('marked') : t('notMarked')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!cancelled && (
                        <ChevronRight
                          className="inline-block size-4 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
