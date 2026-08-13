'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Badge, Card, CardContent, PageHeader, Progress, Skeleton } from '../../../shared/ui'
import { analyticsKeys, fetchGroupAttendance } from '../../../entities/analytics'

function rateTone(rate: number): string {
  return rate >= 75 ? 'bg-success' : rate >= 60 ? 'bg-warning' : 'bg-destructive'
}

// Drill-down: посещаемость по студентам группы (декан → группа → студент).
export function GroupDrilldown({
  groupId,
  groupName,
  onBack,
}: {
  groupId: string
  groupName: string
  onBack: () => void
}) {
  const t = useTranslations('Analytics')
  const q = useQuery({
    queryKey: analyticsKeys.groupAttendance(groupId),
    queryFn: () => fetchGroupAttendance(groupId),
  })

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader
        title={groupName}
        subtitle={t('groupAttendance')}
        onBack={onBack}
        backLabel={t('back')}
      />

      {q.isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <Card>
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {(q.data?.students ?? []).map((s) => (
                <li key={s.studentId} className="flex items-center gap-3 p-2.5">
                  <span className="w-40 shrink-0 truncate text-sm font-medium">
                    {s.lastName} {s.firstName}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Progress
                      value={s.attendanceRate}
                      indicatorClassName={rateTone(s.attendanceRate)}
                    />
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                      {s.tracked > 0 ? `${s.attendanceRate}%` : '—'}
                    </span>
                  </span>
                  {s.tracked > 0 && s.attendanceRate < 60 && (
                    <Badge variant="destructive" className="shrink-0">
                      {t('risk')}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
