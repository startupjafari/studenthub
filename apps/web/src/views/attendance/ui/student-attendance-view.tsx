'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarCheck2, CalendarDays, Check, Clock, FileCheck2, Inbox, X } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableText,
  useTableSort,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  attendanceKeys,
  fetchMyAttendance,
  type AttendanceRecord,
} from '../../../entities/attendance'
import { ATT_BADGE, ATT_KEY } from '../lib/status-visuals'

// Дата · время · дисциплина · отметка · примечание.
const COLS = ['7rem', '6rem', '34%', '10rem', '24%'] as const
// До `md` остаются дата, дисциплина и отметка — по ним отметки и проверяют.
const COLS_NARROW = ['6rem', '0', '46%', '34%', '0'] as const
const HIDE = {
  time: 'hidden md:table-cell',
  note: 'hidden lg:table-cell',
} as const

// «Посещаемость» студента: общий процент + разбивка + последние занятия.
export function StudentAttendanceView() {
  const t = useTranslations('Attendance')
  const locale = useLocale()
  const q = useQuery({ queryKey: attendanceKeys.me(), queryFn: () => fetchMyAttendance() })

  // Сортировка клиентская: сводка приходит одним запросом вместе с отметками — серверу
  // пересортировывать нечего. Статус сравниваем по переводу, а не по значению enum.
  const sortValue = useCallback(
    (r: AttendanceRecord, key: string) => {
      switch (key) {
        case 'time':
          return r.pair.startTime
        case 'subject':
          return r.pair.subject
        case 'status':
          return t(ATT_KEY[r.status])
        case 'note':
          return r.note
        default:
          return r.date
      }
    },
    [t],
  )
  // Без начальной сортировки: отметки приходят свежими сверху — так их и читают.
  const { rows, sort, toggle } = useTableSort(q.data?.records ?? [], sortValue)

  // `min-h-0 flex-1` — цепочка до `main` для режима `fill` таблицы: панель с отметками
  // доходит до низа области контента, а прокручивается тело таблицы, а не страница
  // целиком (как на «Учебном плане» и в очереди деканата).
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('myTitle')} />

      {q.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (q.data?.total ?? 0) === 0 ? (
        <EmptyState icon={<CalendarCheck2 />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        q.data && (
          <>
            {/* Разбивка — плитками, как на дашбордах: процент, объём и четыре статуса
                стоят в одном ряду и сравниваются глазом, без вложенных мини-карточек
                внутри большой. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricTile
                index={0}
                icon={CalendarCheck2}
                label={t('overall')}
                value={`${q.data.rate}%`}
                progress={q.data.rate}
                progressTone={
                  q.data.rate >= 75
                    ? 'bg-success'
                    : q.data.rate >= 50
                      ? 'bg-warning'
                      : 'bg-destructive'
                }
              />
              <MetricTile
                index={1}
                icon={CalendarDays}
                tone="text-muted-foreground"
                label={t('ofLessons', { n: q.data.total })}
                value={q.data.total}
              />
              <MetricTile
                index={2}
                icon={Check}
                tone="text-success"
                label={t('status.present')}
                value={q.data.present}
              />
              <MetricTile
                index={3}
                icon={Clock}
                tone="text-warning"
                label={t('status.late')}
                value={q.data.late}
              />
              <MetricTile
                index={4}
                icon={X}
                tone="text-destructive"
                label={t('status.absent')}
                value={q.data.absent}
              />
              <MetricTile
                index={5}
                icon={FileCheck2}
                tone="text-info"
                label={t('status.excused')}
                value={q.data.excused}
              />
            </div>

            {/* `p-0` у тела: таблица рисует свои отступы сама, иначе между линией шапки
                панели и шапкой таблицы остаётся полоса. `min-h-0 flex-1` у панели и её
                тела — продолжение той же цепочки, без неё таблице некуда растягиваться. */}
            <SectionPanel
              title={t('recent')}
              subtitle={t('recentHint')}
              className="min-h-0 flex-1"
              bodyClassName="flex min-h-0 flex-1 flex-col p-0"
            >
              <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
                <TableHeader>
                  <TableRow>
                    <TableHead sortKey="date" sort={sort} onSort={toggle}>
                      {t('date')}
                    </TableHead>
                    <TableHead sortKey="time" sort={sort} onSort={toggle} className={HIDE.time}>
                      {t('colTime')}
                    </TableHead>
                    <TableHead sortKey="subject" sort={sort} onSort={toggle}>
                      {t('colSubject')}
                    </TableHead>
                    <TableHead sortKey="status" sort={sort} onSort={toggle}>
                      {t('colMark')}
                    </TableHead>
                    <TableHead sortKey="note" sort={sort} onSort={toggle} className={HIDE.note}>
                      {t('colNote')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {new Date(`${r.date.slice(0, 10)}T00:00:00`).toLocaleDateString(locale, {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </TableCell>
                      <TableCell className={cn(HIDE.time, 'text-muted-foreground tabular-nums')}>
                        {r.pair.startTime}
                      </TableCell>
                      <TableCell className="font-medium">
                        <TableText value={r.pair.subject} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={ATT_BADGE[r.status]}>{t(ATT_KEY[r.status])}</Badge>
                      </TableCell>
                      <TableCell className={cn(HIDE.note, 'text-muted-foreground')}>
                        <TableText value={r.note} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </SectionPanel>
          </>
        )
      )}
    </div>
  )
}
