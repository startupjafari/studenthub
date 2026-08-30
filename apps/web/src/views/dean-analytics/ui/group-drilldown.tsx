'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Badge,
  Card,
  PageHeader,
  Progress,
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
  analyticsKeys,
  fetchGroupAttendance,
  type StudentAttendanceStat,
} from '../../../entities/analytics'

// Порог «риска» тот же, что у сервера; здесь он нужен только для тона и бейджа.
const RISK_RATE = 60

function rateTone(rate: number): string {
  return rate >= 75 ? 'bg-success' : rate >= 60 ? 'bg-warning' : 'bg-destructive'
}

const COLS = ['32%', 'auto', '14%'] as const

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

  // Худшие сверху: сюда приходят из списка «требует внимания», а не читать всех подряд
  // по алфавиту. Студенты без отметок — в конец: у них нечего считать, а не ноль.
  const {
    rows: sorted,
    sort,
    toggle,
  } = useTableSort<StudentAttendanceStat>(
    q.data?.students ?? [],
    (s, key) => {
      if (key === 'name') return `${s.lastName} ${s.firstName}`
      if (key === 'rate') return s.tracked > 0 ? s.attendanceRate : null
      if (key === 'tracked') return s.tracked
      return null
    },
    { key: 'rate', dir: 'asc' },
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={groupName}
        subtitle={t('groupAttendance')}
        onBack={onBack}
        backLabel={t('back')}
      />

      {q.isLoading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={toggle}>
                  {t('colStudent')}
                </TableHead>
                <TableHead sortKey="rate" sort={sort} onSort={toggle}>
                  {t('colAttendance')}
                </TableHead>
                <TableHead numeric sortKey="tracked" sort={sort} onSort={toggle}>
                  {t('colTracked')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((s) => {
                const tracked = s.tracked > 0
                const atRisk = tracked && s.attendanceRate < RISK_RATE
                return (
                  <TableRow key={s.studentId} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <TableText value={`${s.lastName} ${s.firstName}`} />
                        {atRisk && <Badge variant="destructive">{t('risk')}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Progress
                          value={s.attendanceRate}
                          indicatorClassName={rateTone(s.attendanceRate)}
                        />
                        <span
                          className={cn(
                            'w-10 shrink-0 text-right text-xs tabular-nums',
                            atRisk && 'font-medium text-destructive',
                          )}
                        >
                          {tracked ? `${s.attendanceRate}%` : '—'}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {s.tracked}
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
