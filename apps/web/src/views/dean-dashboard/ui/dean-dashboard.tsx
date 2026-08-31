'use client'

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { BookOpen, FileClock, GraduationCap, Inbox, Percent, Users } from 'lucide-react'
import {
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import { useChartTheme } from '../../../shared/ui/chart'
import {
  analyticsKeys,
  fetchAtRiskStudents,
  fetchFacultyOverview,
} from '../../../entities/analytics'
import { applicationKeys, fetchQueueStats } from '../../../entities/application-service'

// Тяжёлый recharts — только на клиенте, со скелетоном (FRONTEND_RULES §4, §11).
// Опции у вызова свои: SWC-трансформ next/dynamic читает их статически и принимает
// только объектный литерал на месте.
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
})

// Группы на графике: больше не влезает в читаемую высоту, а нужны худшие.
const WORST_GROUPS = 12

/**
 * Дашборд декана.
 *
 * Раньше здесь была сетка плиток-ссылок по всем разделам — ровно то же, что в сайдбаре
 * слева, только крупнее. Дашборд должен отвечать на вопрос «что сегодня не так», а не
 * дублировать навигацию, поэтому плитки заменены на показатели и три разреза:
 * посещаемость по группам, из-за чего студенты в риске, и что стоит в очереди заявок.
 *
 * Данные — только те, что доступны декану: /analytics/faculty, /analytics/at-risk и
 * статистика очереди заявок. Графики вуза (тренды, нагрузка аудиторий) закрыты ролью
 * UNIVERSITY_ADMIN, и обходить это ради красивого дашборда нельзя.
 */
export function DeanDashboard() {
  const t = useTranslations('Dashboard')
  const tNav = useTranslations('Nav')
  const tErr = useTranslations('Errors')
  const { palette } = useChartTheme()

  const overview = useQuery({
    queryKey: analyticsKeys.faculty(undefined),
    queryFn: () => fetchFacultyOverview(),
  })
  const risk = useQuery({
    queryKey: analyticsKeys.atRisk(undefined),
    queryFn: () => fetchAtRiskStudents(),
  })
  const queue = useQuery({
    queryKey: [...applicationKeys.all, 'queue-stats'],
    queryFn: fetchQueueStats,
  })

  const totals = overview.data?.totals
  const lowThreshold = risk.data?.thresholds.attendance ?? 60

  // Худшие группы сверху: график для того и нужен, чтобы увидеть проседание.
  // Группы без отметок не рисуем вовсе — нулевой столбик прочитался бы как «ноль
  // процентов посещаемости», хотя там просто нечего считать.
  const groups = [...(overview.data?.groups ?? [])]
    .filter((g) => g.attendanceTracked > 0)
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .slice(0, WORST_GROUPS)

  const students = risk.data?.students ?? []
  const riskCounts = [
    students.filter((s) => s.reasons.some((r) => r.kind === 'LOW_ATTENDANCE')).length,
    students.filter((s) => s.reasons.some((r) => r.kind === 'OVERDUE_ASSIGNMENTS')).length,
    students.filter((s) => s.reasons.some((r) => r.kind === 'LOW_GRADES')).length,
  ]
  const riskLabels = [t('riskAttendance'), t('riskOverdue'), t('riskGrades')]

  const q = queue.data
  const queueLabels = [
    t('queueNew'),
    t('queueInWork'),
    t('queueActionNeeded'),
    t('queueReady'),
    t('queueOverdue'),
  ]
  const queueValues = [q?.new ?? 0, q?.inWork ?? 0, q?.actionNeeded ?? 0, q?.ready ?? 0, q?.overdue ?? 0] // prettier-ignore

  if (overview.isError) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <PageHeader title={tNav('dashboard')} />
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={tErr('INTERNAL_ERROR')}
          action={<Button onClick={() => overview.refetch()}>{t('retry')}</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={tNav('dashboard')} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          icon={Users}
          label={t('kpiStudents')}
          value={totals?.students ?? null}
          loading={overview.isLoading}
          href="/dean/students"
        />
        <MetricTile
          icon={BookOpen}
          label={t('kpiGroups')}
          value={totals?.groups ?? null}
          loading={overview.isLoading}
          href="/dean/groups"
        />
        <MetricTile
          icon={Percent}
          tone="text-info"
          label={t('kpiAttendance')}
          value={totals ? `${totals.attendanceRate}%` : null}
          valueTone={
            totals && totals.attendanceRate < lowThreshold ? 'text-destructive' : undefined
          }
          loading={overview.isLoading}
          href="/dean/analytics"
        />
        <MetricTile
          icon={FileClock}
          tone="text-warning"
          label={t('kpiSubmissions')}
          value={totals?.submissionsPending ?? null}
          loading={overview.isLoading}
        />
        <MetricTile
          icon={GraduationCap}
          label={t('kpiExams')}
          value={totals?.examsUpcoming ?? null}
          loading={overview.isLoading}
          href="/dean/exams"
        />
      </div>

      {/* Посещаемость по группам — во всю ширину: подписи групп длинные, на половине
          карточки полосы сжимаются до неразличимых. */}
      <SectionPanel title={t('chartAttendance')} subtitle={t('chartAttendanceHint')}>
        {overview.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : groups.length === 0 ? (
          <EmptyState title={t('chartNoAttendance')} className="border-0 p-6" />
        ) : (
          <BarChart
            ariaLabel={t('chartAttendance')}
            palette={palette}
            height={Math.max(200, groups.length * 26 + 40)}
            labels={groups.map((g) => g.name)}
            values={groups.map((g) => g.attendanceRate)}
            seriesName={t('percentShort')}
          />
        )}
      </SectionPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel title={t('chartRisk')} subtitle={t('chartRiskHint')}>
          {risk.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : students.length === 0 ? (
            <EmptyState title={t('chartNoRisk')} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('chartRisk')}
              palette={palette}
              height={180}
              labels={riskLabels}
              values={riskCounts}
              seriesName={t('studentsShort')}
            />
          )}
        </SectionPanel>

        <SectionPanel title={t('chartQueue')} subtitle={t('chartQueueHint')}>
          {queue.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : queueValues.every((v) => v === 0) ? (
            <EmptyState title={t('chartNoQueue')} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('chartQueue')}
              palette={palette}
              height={200}
              labels={queueLabels}
              values={queueValues}
              seriesName={t('applicationsShort')}
            />
          )}
        </SectionPanel>
      </div>
    </div>
  )
}
