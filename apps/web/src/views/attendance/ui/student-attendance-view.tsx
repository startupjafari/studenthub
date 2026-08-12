'use client'

import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarCheck2, Inbox } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Progress,
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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
            <Card>
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="font-heading text-3xl font-semibold tabular-nums">
                      {q.data.rate}%
                    </div>
                    <div className="text-sm text-muted-foreground">{t('overall')}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {t('ofLessons', { n: q.data.total })}
                  </div>
                </div>
                <Progress
                  value={q.data.rate}
                  indicatorClassName={
                    q.data.rate >= 75
                      ? 'bg-success'
                      : q.data.rate >= 50
                        ? 'bg-warning'
                        : 'bg-destructive'
                  }
                />
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Stat label={t('status.present')} value={q.data.present} tone="text-success" />
                  <Stat
                    label={t('status.late')}
                    value={q.data.late}
                    tone="text-warning-foreground dark:text-warning"
                  />
                  <Stat label={t('status.absent')} value={q.data.absent} tone="text-destructive" />
                  <Stat label={t('status.excused')} value={q.data.excused} tone="text-info" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('recent')}</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className={`font-heading text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
