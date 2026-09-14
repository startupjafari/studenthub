'use client'

import { useMemo, useState } from 'react'
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
import { scheduleKeys, fetchSchedule, type Pair } from '../../../entities/schedule'
import { attendanceKeys, fetchMarkedPairs } from '../../../entities/attendance'
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

  const dayPairs = useMemo(() => {
    const pairs = schedule.data?.pairs ?? []
    const d = new Date(`${date}T00:00:00`)
    const dow = ((d.getDay() + 6) % 7) + 1
    const parity = isoWeekParity(d)
    return pairs
      .filter((p) => p.dayOfWeek === dow && (p.weekType === 'BOTH' || p.weekType === parity))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }, [schedule.data?.pairs, date])

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
    if (key === 'time') return p.startTime
    if (key === 'subject') return p.subject
    if (key === 'room') return p.room?.name ?? null
    if (key === 'state') return markedIds.has(p.id) ? 1 : 0
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
              {sorted.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => setOpenPairId(p.id)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell className="tabular-nums text-muted-foreground">
                    {p.startTime}
                    {/* Конец пары — уточнение: до `md` колонка под него не растягивается. */}
                    <span className="hidden md:inline"> – {p.endTime}</span>
                  </TableCell>
                  <TableCell className="font-medium">
                    <TableText value={p.subject} />
                  </TableCell>
                  <TableCell className={cn(HIDE.room, 'text-muted-foreground')}>
                    {p.room ? <TableText value={p.room.name} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={markedIds.has(p.id) ? 'success' : 'outline'}
                      className="max-w-full truncate"
                    >
                      {markedIds.has(p.id) ? t('marked') : t('notMarked')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight
                      className="inline-block size-4 text-muted-foreground"
                      aria-hidden
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
