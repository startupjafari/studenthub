'use client'

import dynamic from 'next/dynamic'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardList,
  DoorClosed,
  GraduationCap,
  Percent,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppSelector } from '../../../shared/store'
import { fetchUniversityStats, universityKeys } from '../../../entities/university'
import { fetchFaculties, facultyKeys } from '../../../entities/faculty'
import {
  analyticsKeys,
  fetchFacultyOverview,
  fetchApplicationsFlow,
  fetchAttendanceBreakdown,
  fetchAttendanceTrend,
  fetchExamResults,
  fetchRoomLoad,
  fetchUniversityInvitesFunnel,
  universityAnalyticsKeys,
} from '../../../entities/analytics'
import { Badge, EmptyState, MetricTile, Progress, SectionPanel, Skeleton } from '../../../shared/ui'
import { ActivityGrid, useChartTheme, type ChartSeries } from '../../../shared/ui/chart'
import { ChartLegend } from '../../platform-dashboard/ui/primitives'

// Тяжёлый recharts — только на клиенте, со скелетоном (docs/FRONTEND_RULES.md §4, §11).
// Опции у каждого вызова свои: SWC-трансформ next/dynamic читает их статически и
// принимает только объектный литерал на месте — вынесенная в переменную общая
// константа роняет сборку («next/dynamic options must be an object literal»).
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
})
const LineChart = dynamic(() => import('../../../shared/ui/chart/line-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
})
const StackedBarChart = dynamic(() => import('../../../shared/ui/chart/stacked-bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
})

// Сколько групп показываем на графике посещаемости: больше не влезает в читаемую высоту,
// а нужны худшие — сервер уже отдаёт группы по возрастанию посещаемости.
const WORST_GROUPS = 12
/** Окно рядов по неделям: 12 ≈ семестр. */
const TREND_WEEKS = 12
/**
 * Линий в тренде посещаемости. Категориальных слотов в палитре ровно три, и их
 * порядок — механизм CVD-безопасности (shared/ui/chart/palette.ts): рисовать больше
 * серий значило бы брать цвета «на глаз». Показываем три худших факультета — именно
 * им нужно внимание; остальные видны в структуре посещаемости рядом.
 */
const TREND_FACULTIES = 3

/**
 * Дашборд администратора вуза (docs/PROJECT.md §12.1).
 *
 * Три слоя: живые показатели дня, структура вуза, и панели-агрегаты, каждая из
 * которых отвечает на один управленческий вопрос. Плитки и панели — системные
 * `MetricTile` / `SectionPanel`, чтобы дашборд вуза, аналитика факультета и обзор
 * документов читались одной шкалой.
 */
export function StatsDashboard() {
  const t = useTranslations('Stats')
  const tErr = useTranslations('Errors')
  const { palette } = useChartTheme()
  const universityId = useAppSelector((s) => s.auth.universityId)

  const stats = useQuery({
    queryKey: universityKeys.stats(universityId ?? ''),
    queryFn: () => fetchUniversityStats(universityId as string),
    enabled: !!universityId,
  })
  const faculties = useQuery({ queryKey: facultyKeys.list(), queryFn: () => fetchFaculties() })

  const overviews = useQueries({
    queries: (faculties.data ?? []).map((f) => ({
      queryKey: analyticsKeys.faculty(f.id),
      queryFn: () => fetchFacultyOverview(f.id),
      // Один недоступный факультет не должен ронять весь дашборд.
      retry: false,
    })),
  })
  const loadedOverviews = overviews.map((q) => q.data).filter((d) => d !== undefined)
  const analyticsLoading = faculties.isLoading || overviews.some((q) => q.isLoading)

  // Посещаемость по вузу — среднее по группам с размеченной посещаемостью.
  const groupStats = loadedOverviews.flatMap((o) => o.groups)
  const tracked = groupStats.filter((g) => g.attendanceTracked > 0)
  const attendanceRate =
    tracked.length > 0
      ? Math.round(tracked.reduce((acc, g) => acc + g.attendanceRate, 0) / tracked.length)
      : null
  const submissionsPending = loadedOverviews.reduce((a, o) => a + o.totals.submissionsPending, 0)
  const examsUpcoming = loadedOverviews.reduce((a, o) => a + o.totals.examsUpcoming, 0)
  const atRisk = loadedOverviews
    .flatMap((o) => o.atRisk)
    .sort((a, b) => a.attendanceRate - b.attendanceRate)

  const worst = [...tracked]
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .slice(0, WORST_GROUPS)

  if (!universityId) return <EmptyState title={t('noUniversity')} />
  if (stats.isError) return <EmptyState title={tErr('INTERNAL_ERROR')} />

  const structure: { key: string; value: number | null; icon: LucideIcon }[] = [
    { key: 'faculties', value: stats.data?.faculties ?? null, icon: Building2 },
    { key: 'groups', value: stats.data?.groups ?? null, icon: Users },
    { key: 'students', value: stats.data?.students ?? null, icon: GraduationCap },
    { key: 'teachers', value: stats.data?.teachers ?? null, icon: BookOpen },
    { key: 'rooms', value: stats.data?.rooms ?? null, icon: DoorClosed },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Живые показатели — впереди структуры: за ними приходят каждый день, а число
          факультетов меняется раз в год. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          icon={Percent}
          tone="text-info"
          label={t('attendanceRate')}
          value={attendanceRate === null ? null : `${attendanceRate}%`}
          loading={analyticsLoading}
        />
        <MetricTile
          icon={ClipboardList}
          tone="text-warning"
          label={t('submissionsPending')}
          value={submissionsPending}
          loading={analyticsLoading}
        />
        <MetricTile
          icon={CalendarClock}
          label={t('examsUpcoming')}
          value={examsUpcoming}
          loading={analyticsLoading}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {structure.map((tile) => (
          <MetricTile
            key={tile.key}
            icon={tile.icon}
            label={t(tile.key)}
            value={tile.value}
            loading={stats.isLoading}
          />
        ))}
      </div>

      {/* Динамика — во всю ширину: тренд читают первым, и линии на половине карточки
          сплющиваются до неразличимых. */}
      <AttendanceTrendPanel />

      <div className="grid gap-4 lg:grid-cols-2">
        <AttendanceBreakdownPanel />
        <SectionPanel title={t('attendanceByGroup')} subtitle={t('attendanceByGroupHint')}>
          {analyticsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : worst.length === 0 ? (
            <Empty text={t('noAttendance')} />
          ) : (
            <BarChart
              ariaLabel={t('attendanceByGroup')}
              palette={palette}
              height={Math.max(200, worst.length * 26 + 40)}
              labels={worst.map((g) => g.name)}
              values={worst.map((g) => g.attendanceRate)}
              seriesName={t('percentShort')}
            />
          )}
        </SectionPanel>
      </div>

      <RoomLoadPanel />

      <div className="grid gap-4 lg:grid-cols-2">
        <ExamResultsPanel />
        <ApplicationsFlowPanel />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InvitesFunnelPanel />
        <SectionPanel title={t('atRiskTitle')} subtitle={t('atRiskHint')}>
          {analyticsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : atRisk.length === 0 ? (
            <Empty text={t('atRiskEmpty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {atRisk.map((g) => (
                <li key={g.groupId} className="flex items-center gap-3 py-2.5">
                  <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                  <Badge variant="outline">{g.attendanceRate}%</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>
      </div>
    </div>
  )
}

// ── Панели ───────────────────────────────────────────────────────────────────

/** 1. Стало лучше или хуже: посещаемость по неделям, худшие факультеты линиями. */
function AttendanceTrendPanel() {
  const t = useTranslations('Stats')
  const fmt = useFormatter()
  const { palette } = useChartTheme()
  const q = useQuery({
    queryKey: universityAnalyticsKeys.attendanceTrend(TREND_WEEKS),
    queryFn: () => fetchAttendanceTrend(TREND_WEEKS),
  })

  // Худшие — по последней известной неделе: сравнивать по среднему за семестр значит
  // прятать факультет, который просел только что.
  const ranked = [...(q.data?.series ?? [])]
    .filter((s) => s.points.length > 0)
    .sort((a, b) => lastValue(a.points) - lastValue(b.points))
    .slice(0, TREND_FACULTIES)

  const labels = longestPoints(ranked).map((p) =>
    fmt.dateTime(new Date(p.at), { day: 'numeric', month: 'short' }),
  )
  const series: ChartSeries[] = ranked.map((s, i) => ({
    key: s.facultyId,
    label: s.name,
    color: palette.series[i % palette.series.length] as string,
    values: s.points.map((p) => p.value),
  }))

  return (
    <SectionPanel title={t('trendTitle')} subtitle={t('trendHint')}>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : series.length === 0 ? (
        <Empty text={t('noAttendance')} />
      ) : (
        <>
          <ChartLegend
            className="mb-2"
            items={series.map((s) => ({
              key: s.key,
              label: s.label,
              color: s.color,
              line: true,
              value: `${s.values[s.values.length - 1] ?? 0}%`,
            }))}
          />
          <LineChart
            ariaLabel={t('trendTitle')}
            palette={palette}
            labels={labels}
            series={series}
          />
        </>
      )}
    </SectionPanel>
  )
}

/** 2. Прогул и опоздание — разные проблемы: структура посещаемости по факультетам. */
function AttendanceBreakdownPanel() {
  const t = useTranslations('Stats')
  const { palette } = useChartTheme()
  const q = useQuery({
    queryKey: universityAnalyticsKeys.attendanceBreakdown(),
    queryFn: fetchAttendanceBreakdown,
  })
  const items = q.data?.items ?? []

  // Статусы — состояния, а не серии: цвета берём из статусной части палитры и
  // обязательно дублируем подписью в легенде.
  const series: ChartSeries[] = [
    { key: 'present', label: t('attPresent'), color: palette.status.good, values: items.map((i) => i.present) }, // prettier-ignore
    { key: 'late', label: t('attLate'), color: palette.status.warning, values: items.map((i) => i.late) }, // prettier-ignore
    { key: 'excused', label: t('attExcused'), color: palette.status.serious, values: items.map((i) => i.excused) }, // prettier-ignore
    { key: 'absent', label: t('attAbsent'), color: palette.status.critical, values: items.map((i) => i.absent) }, // prettier-ignore
  ]

  return (
    <SectionPanel title={t('breakdownTitle')} subtitle={t('breakdownHint')}>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Empty text={t('noAttendance')} />
      ) : (
        <>
          <ChartLegend
            className="mb-2"
            items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
          />
          <StackedBarChart
            ariaLabel={t('breakdownTitle')}
            palette={palette}
            labels={items.map((i) => i.name)}
            series={series}
            totalLabel={t('totalLabel')}
          />
        </>
      )}
    </SectionPanel>
  )
}

/** 3. Хватает ли помещений: сетка «день недели × час начала пары». */
function RoomLoadPanel() {
  const t = useTranslations('Stats')
  const { palette } = useChartTheme()
  const q = useQuery({ queryKey: universityAnalyticsKeys.roomLoad(), queryFn: fetchRoomLoad })
  const dayLabels = [t('mon'), t('tue'), t('wed'), t('thu'), t('fri'), t('sat'), t('sun')]

  return (
    <SectionPanel
      title={t('roomLoadTitle')}
      subtitle={
        q.data ? t('roomLoadHintWithPeak', { peak: q.data.peak, rooms: q.data.rooms }) : t('roomLoadHint') // prettier-ignore
      }
    >
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !q.data || q.data.peak === 0 ? (
        <Empty text={t('noSchedule')} />
      ) : (
        <ActivityGrid
          ariaLabel={t('roomLoadTitle')}
          cells={q.data.grid}
          max={q.data.peak}
          palette={palette}
          dayLabels={dayLabels}
          cellTitle={(day, hour, value) => t('roomLoadCell', { day, hour, value })}
        />
      )}
    </SectionPanel>
  )
}

/** 4. Не сколько экзаменов, а чем кончились: исход сессии по факультетам. */
function ExamResultsPanel() {
  const t = useTranslations('Stats')
  const { palette } = useChartTheme()
  const q = useQuery({
    queryKey: universityAnalyticsKeys.examResults(),
    queryFn: fetchExamResults,
  })
  const items = q.data?.items ?? []
  const series: ChartSeries[] = [
    { key: 'passed', label: t('examPassed'), color: palette.status.good, values: items.map((i) => i.passed) }, // prettier-ignore
    { key: 'retake', label: t('examRetake'), color: palette.status.warning, values: items.map((i) => i.retake) }, // prettier-ignore
    { key: 'absent', label: t('examAbsent'), color: palette.status.serious, values: items.map((i) => i.absent) }, // prettier-ignore
    { key: 'failed', label: t('examFailed'), color: palette.status.critical, values: items.map((i) => i.failed) }, // prettier-ignore
  ]

  return (
    <SectionPanel title={t('examResultsTitle')} subtitle={t('examResultsHint')}>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Empty text={t('noExamResults')} />
      ) : (
        <>
          <ChartLegend
            className="mb-2"
            items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
          />
          <StackedBarChart
            ariaLabel={t('examResultsTitle')}
            palette={palette}
            labels={items.map((i) => i.name)}
            series={series}
            totalLabel={t('totalLabel')}
          />
        </>
      )}
    </SectionPanel>
  )
}

/** 5. Успевает ли деканат: поступление, закрытие и просрочка заявок по неделям. */
function ApplicationsFlowPanel() {
  const t = useTranslations('Stats')
  const fmt = useFormatter()
  const { palette } = useChartTheme()
  const q = useQuery({
    queryKey: universityAnalyticsKeys.applicationsFlow(TREND_WEEKS),
    queryFn: () => fetchApplicationsFlow(TREND_WEEKS),
  })
  const points = q.data?.points ?? []
  const labels = points.map((p) => fmt.dateTime(new Date(p.at), { day: 'numeric', month: 'short' }))
  const series: ChartSeries[] = [
    { key: 'submitted', label: t('appsSubmitted'), color: palette.series[0], values: points.map((p) => p.submitted) }, // prettier-ignore
    { key: 'closed', label: t('appsClosed'), color: palette.series[2], values: points.map((p) => p.closed) }, // prettier-ignore
    { key: 'overdue', label: t('appsOverdue'), color: palette.status.critical, values: points.map((p) => p.overdue) }, // prettier-ignore
  ]
  const empty = points.every((p) => p.submitted === 0 && p.closed === 0)

  return (
    <SectionPanel title={t('appsFlowTitle')} subtitle={t('appsFlowHint')}>
      {q.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : empty ? (
        <Empty text={t('noApplications')} />
      ) : (
        <>
          <ChartLegend
            className="mb-2"
            items={series.map((s) => ({
              key: s.key,
              label: s.label,
              color: s.color,
              line: true,
              value: String(s.values.reduce((a, b) => a + b, 0)),
            }))}
          />
          <LineChart
            ariaLabel={t('appsFlowTitle')}
            palette={palette}
            labels={labels}
            series={series}
          />
        </>
      )}
    </SectionPanel>
  )
}

/** 6. Доходят ли приглашённые до регистрации: воронка инвайтов вуза. */
function InvitesFunnelPanel() {
  const t = useTranslations('Stats')
  const q = useQuery({
    queryKey: universityAnalyticsKeys.invitesFunnel(),
    queryFn: fetchUniversityInvitesFunnel,
  })
  const d = q.data

  return (
    <SectionPanel title={t('invitesTitle')} subtitle={t('invitesHint')}>
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !d || d.total === 0 ? (
        <Empty text={t('noInvites')} />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Конверсия — главное число панели: остальные строки объясняют, куда делись
              непринятые приглашения. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">{t('invitesConversion')}</span>
            <span className="text-2xl leading-none font-semibold tabular-nums">
              {d.conversion}%
            </span>
          </div>
          <Progress value={d.conversion} indicatorClassName="bg-success" />
          <ul className="flex flex-col divide-y divide-border text-sm">
            <FunnelRow label={t('invitesIssued')} value={d.total} />
            <FunnelRow label={t('invitesUsed')} value={d.used} />
            <FunnelRow label={t('invitesPending')} value={d.pending} />
            <FunnelRow label={t('invitesExpired')} value={d.expired} />
            <FunnelRow label={t('invitesRevoked')} value={d.revoked} />
          </ul>
        </div>
      )}
    </SectionPanel>
  )
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </li>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>
}

function lastValue(points: { value: number }[]): number {
  return points[points.length - 1]?.value ?? 0
}

/**
 * Подписи оси берём у самого длинного ряда: у факультетов, где посещаемость начали
 * отмечать позже, недель меньше, и по короткому ряду ось обрезала бы остальные.
 */
function longestPoints<T extends { points: unknown[] }>(series: T[]): T['points'] {
  return series.reduce<T['points']>(
    (best, s) => (s.points.length > best.length ? s.points : best),
    [],
  )
}
