'use client'

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
} from '../../../shared/ui'
import { attendanceKeys, fetchMyAttendance } from '../../../entities/attendance'
import { ATT_BADGE, ATT_KEY } from '../lib/status-visuals'

// «Посещаемость» студента: общий процент + разбивка + последние занятия.
export function StudentAttendanceView() {
  const t = useTranslations('Attendance')
  const locale = useLocale()
  const q = useQuery({ queryKey: attendanceKeys.me(), queryFn: () => fetchMyAttendance() })

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
                icon={CalendarDays}
                tone="text-muted-foreground"
                label={t('ofLessons', { n: q.data.total })}
                value={q.data.total}
              />
              <MetricTile
                icon={Check}
                tone="text-success"
                label={t('status.present')}
                value={q.data.present}
              />
              <MetricTile
                icon={Clock}
                tone="text-warning"
                label={t('status.late')}
                value={q.data.late}
              />
              <MetricTile
                icon={X}
                tone="text-destructive"
                label={t('status.absent')}
                value={q.data.absent}
              />
              <MetricTile
                icon={FileCheck2}
                tone="text-info"
                label={t('status.excused')}
                value={q.data.excused}
              />
            </div>

            <SectionPanel title={t('recent')} subtitle={t('recentHint')}>
              <ul className="flex flex-col gap-1.5">
                {q.data.records.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                  >
                    <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {new Date(`${r.date.slice(0, 10)}T00:00:00`).toLocaleDateString(locale, {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {r.pair.subject}
                    </span>
                    <Badge variant={ATT_BADGE[r.status]} className="shrink-0">
                      {t(ATT_KEY[r.status])}
                    </Badge>
                  </li>
                ))}
              </ul>
            </SectionPanel>
          </>
        )
      )}
    </div>
  )
}
