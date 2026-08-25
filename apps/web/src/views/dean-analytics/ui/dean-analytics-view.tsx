'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  FileClock,
  GraduationCap,
  Inbox,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { useAppSelector } from '../../../shared/store'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  analyticsKeys,
  fetchFacultyOverview,
  fetchAtRiskStudents,
  type RiskReason,
} from '../../../entities/analytics'
import { GroupDrilldown } from './group-drilldown'

function rateTone(rate: number): string {
  return rate >= 75 ? 'bg-success' : rate >= 60 ? 'bg-warning' : 'bg-destructive'
}

// Аналитика факультета (задача 14): показатели, «требует внимания», drill-down по группам.
// У декана факультет один — берётся из токена. Админу и модератору вуза сервер факультет
// не выводит (analytics.service: resolveFaculty), поэтому им нужен выбор в шапке.
export function DeanAnalyticsView() {
  const t = useTranslations('Analytics')
  const role = useAppSelector((s) => s.auth.role)
  const picksFaculty = role !== null && role !== Role.DEAN
  const faculties = useQuery({
    queryKey: facultyKeys.list(),
    queryFn: () => fetchFaculties(),
    enabled: picksFaculty,
  })
  const [facultyId, setFacultyId] = useState('')
  // Первый факультет выбираем сами: пустой экран с одним селектом ничего не сообщает.
  useEffect(() => {
    const first = faculties.data?.[0]
    if (picksFaculty && !facultyId && first) setFacultyId(first.id)
  }, [picksFaculty, facultyId, faculties.data])

  const ready = !picksFaculty || !!facultyId
  const scope = picksFaculty ? facultyId : undefined
  const q = useQuery({
    queryKey: analyticsKeys.faculty(scope),
    queryFn: () => fetchFacultyOverview(scope),
    enabled: ready,
  })
  // Early Warning (PR-7): студенты «требует внимания» с явными причинами.
  const risk = useQuery({
    queryKey: analyticsKeys.atRisk(scope),
    queryFn: () => fetchAtRiskStudents(scope),
    enabled: ready,
  })
  const [drillGroup, setDrillGroup] = useState<{ id: string; name: string } | null>(null)

  if (drillGroup) {
    return (
      <GroupDrilldown
        groupId={drillGroup.id}
        groupName={drillGroup.name}
        onBack={() => setDrillGroup(null)}
      />
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          picksFaculty ? (
            <Select value={facultyId} onValueChange={setFacultyId}>
              <SelectTrigger className="h-9 w-56 text-sm" aria-label={t('faculty')}>
                <SelectValue placeholder={t('faculty')} />
              </SelectTrigger>
              <SelectContent>
                {faculties.data?.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<Inbox />}
          title={t('loadError')}
          action={<Button onClick={() => q.refetch()}>{t('retry')}</Button>}
        />
      ) : (
        q.data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi icon={Users} label={t('kpi.students')} value={q.data.totals.students} />
              <Kpi icon={BookOpen} label={t('kpi.groups')} value={q.data.totals.groups} />
              <Kpi
                icon={GraduationCap}
                label={t('kpi.attendance')}
                value={`${q.data.totals.attendanceRate}%`}
                tone={q.data.totals.attendanceRate < 60 ? 'text-destructive' : 'text-foreground'}
              />
              <Kpi
                icon={FileClock}
                label={t('kpi.submissionsPending')}
                value={q.data.totals.submissionsPending}
              />
              <Kpi
                icon={GraduationCap}
                label={t('kpi.examsUpcoming')}
                value={q.data.totals.examsUpcoming}
              />
            </div>

            {q.data.atRisk.length > 0 && (
              <Card className="ring-1 ring-warning/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle
                      className="size-4 text-warning-foreground dark:text-warning"
                      aria-hidden
                    />
                    {t('attention')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1.5">
                    {q.data.atRisk.map((g) => (
                      <li key={g.groupId}>
                        <button
                          type="button"
                          onClick={() => setDrillGroup({ id: g.groupId, name: g.name })}
                          className="flex w-full items-center gap-3 rounded-lg border border-border p-2.5 text-left transition-colors hover:bg-muted/50"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {g.name}
                          </span>
                          <Badge variant="destructive">
                            {t('lowAttendance', { rate: g.attendanceRate })}
                          </Badge>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {risk.data && risk.data.students.length > 0 && (
              <Card className="ring-1 ring-destructive/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4 text-destructive" aria-hidden />
                    {t('riskStudents')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1.5">
                    {risk.data.students.map((s) => (
                      <li
                        key={s.studentId}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {s.lastName} {s.firstName}
                          {s.groupName && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              {s.groupName}
                            </span>
                          )}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {s.reasons.map((r) => (
                            <ReasonChip key={r.kind} reason={r} t={t} />
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('groups')}</CardTitle>
              </CardHeader>
              <CardContent>
                {q.data.groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noGroups')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {q.data.groups.map((g) => (
                      <li key={g.groupId}>
                        <button
                          type="button"
                          onClick={() => setDrillGroup({ id: g.groupId, name: g.name })}
                          className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
                        >
                          <span className="w-32 shrink-0 truncate text-sm font-medium">
                            {g.name}
                          </span>
                          <span className="w-16 shrink-0 text-xs text-muted-foreground">
                            {t('studentsN', { n: g.students })}
                          </span>
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <Progress
                              value={g.attendanceRate}
                              indicatorClassName={rateTone(g.attendanceRate)}
                            />
                            <span className="w-10 shrink-0 text-right text-xs tabular-nums">
                              {g.attendanceTracked > 0 ? `${g.attendanceRate}%` : '—'}
                            </span>
                          </span>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  )
}

// Чип причины риска с явным числовым значением (без скрытого скоринга).
function ReasonChip({ reason, t }: { reason: RiskReason; t: ReturnType<typeof useTranslations> }) {
  if (reason.kind === 'OVERDUE_ASSIGNMENTS') {
    return <Badge variant="secondary">{t('reason.overdue', { value: reason.value })}</Badge>
  }
  const key = reason.kind === 'LOW_ATTENDANCE' ? 'reason.lowAttendance' : 'reason.lowGrades'
  return <Badge variant="destructive">{t(key, { value: reason.value })}</Badge>
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone = 'text-foreground',
}: {
  icon: LucideIcon
  label: string
  value: number | string
  tone?: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className={`font-heading text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  )
}
