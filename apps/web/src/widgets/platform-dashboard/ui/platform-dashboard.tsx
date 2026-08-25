'use client'

import { useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import {
  fetchActiveUsers,
  fetchActivityHeatmap,
  fetchComplaintsFlow,
  fetchComplaintsLatency,
  fetchInvitesFunnel,
  fetchPlatformOverview,
  fetchTopActions,
  fetchUniversitiesSize,
  fetchUsersGrowth,
  platformAnalyticsKeys,
  type MultiSeries,
  type PlatformRange,
} from '../../../entities/analytics'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  SegmentedTabs,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { useChartTheme } from '../../../shared/ui/chart'
import { useInView } from './use-in-view'
import { Sparkline } from './sparkline'
import { ActivityGrid, ChartLegend, Meter, StatTile } from './primitives'
import { useCountUp } from './use-count-up'

// Тяжёлый recharts — только на клиенте (FRONTEND_RULES §4, §11), со скелетоном.
const loading = (h: number) => () => <Skeleton className="w-full" style={{ height: h }} />
const LineChart = dynamic(() => import('../../../shared/ui/chart/line-chart'), {
  ssr: false,
  loading: loading(260),
})
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: loading(260),
})
const StackedBarChart = dynamic(() => import('../../../shared/ui/chart/stacked-bar-chart'), {
  ssr: false,
  loading: loading(200),
})

/**
 * Окно дашборда. Шаг корзины растёт вместе с окном: 90 дней по дням дают 90 точек
 * на панель шириной в пол-экрана — это уже не форма, а шум, поэтому неделя.
 */
const RANGES = [
  { key: '7', days: 7, interval: 'day' },
  { key: '30', days: 30, interval: 'day' },
  { key: '90', days: 90, interval: 'week' },
] as const
type RangeKey = (typeof RANGES)[number]['key']
const DEFAULT_RANGE: RangeKey = '30'

/**
 * Курсор синхронизирован между временными панелями: наведение на дату в одной
 * показывает эту же дату в остальных. Идентификатор общий — на нём и держится связь.
 */
const TIME_SYNC = 'platform-time'

/** Данные живут в Redis 300 с — держим их свежими столько же и на клиенте. */
const STALE_MS = 300_000

const LATENCY_ORDER = ['lt1h', 'lt4h', 'lt1d', 'lt3d', 'lt7d', 'gte7d'] as const
const INVITE_STATUSES = ['USED', 'PENDING', 'EXPIRED', 'REVOKED'] as const

// Наборы ключей серий — константы модуля, а не литералы в теле компонента:
// новый массив на каждый рендер обнулял бы useMemo внутри useSeries.
const GROWTH_KEYS = ['students', 'teachers', 'staff'] as const
const ACTIVE_KEYS = ['dau', 'wau'] as const
const FLOW_KEYS = ['created', 'resolved'] as const

/**
 * Период по выбранному окну, правый край округлён до часа. Округление важно —
 * иначе `new Date()` на каждом монтировании даёт новый ключ запроса, и кэш
 * (и клиентский, и Redis) не переиспользуется ни разу.
 */
function useRange(rangeKey: RangeKey): PlatformRange {
  return useMemo(() => {
    const preset = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]
    const now = new Date()
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
    )
    const from = new Date(to.getTime() - preset.days * 86_400_000)
    return { from: from.toISOString(), to: to.toISOString(), interval: preset.interval }
  }, [rangeKey])
}

export function PlatformDashboard() {
  const t = useTranslations('PlatformDashboard')
  const tNav = useTranslations('Nav')
  const [rangeKey, setRangeKey] = useState<RangeKey>(DEFAULT_RANGE)
  const range = useRange(rangeKey)

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка страницы (DESIGN_SYSTEM §10.1) — она же держит переключатель окна.
          Переключатель один на все панели: у каждой свой период графики показывали бы
          разные срезы рядом друг с другом. Плитки сверху ему не подчиняются — у них окна
          зафиксированы на сервере и подписаны в подсказке. Место — слот `actions`
          (справа), а не `tabs`: это фильтр периода, а не разделы страницы. */}
      <PageHeader
        title={tNav('dashboard')}
        subtitle={t('subtitle')}
        actions={
          <SegmentedTabs
            aria-label={t('rangeLabel')}
            value={rangeKey}
            onChange={setRangeKey}
            items={RANGES.map((r) => ({ value: r.key, label: t('rangeDays', { days: r.days }) }))}
          />
        }
      />
      <KpiRow />
      <div className="grid gap-4 lg:grid-cols-2">
        <GrowthPanel range={range} />
        <ActiveUsersPanel range={range} />
        <UniversitiesPanel />
        <ComplaintsFlowPanel range={range} />
        <LatencyPanel range={range} />
        <InvitesPanel range={range} />
        <HeatmapPanel range={range} />
        <ActionsPanel range={range} />
      </div>
    </div>
  )
}

// ── Плитки ───────────────────────────────────────────────────────────────────

function KpiRow() {
  const t = useTranslations('PlatformDashboard')
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])

  const overview = useQuery({
    queryKey: platformAnalyticsKeys.overview(),
    queryFn: fetchPlatformOverview,
    staleTime: STALE_MS,
  })

  if (overview.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </div>
    )
  }
  const o = overview.data
  if (!o) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <CountTile
        index={0}
        label={t('kpiUniversities')}
        target={o.universities.active}
        hint={t('kpiUniversitiesHint', { pending: o.universities.pending })}
      />
      <CountTile
        index={1}
        label={t('kpiUsers')}
        target={o.users.total}
        hint={t('kpiUsersHint')}
        spark={<Sparkline values={o.users.spark} ariaLabel={t('kpiUsersHint')} />}
      />
      <CountTile
        index={2}
        label={t('kpiComplaints')}
        target={o.complaints.pending}
        hint={t('kpiComplaintsHint')}
        spark={<Sparkline values={o.complaints.spark} ariaLabel={t('kpiComplaintsHint')} />}
      />
      <CountTile
        index={3}
        label={t('kpiResolution')}
        target={o.resolutionHours.median}
        fractional
        format={(v) => t('hours', { h: v })}
        delta={deltaOf(o.resolutionHours, t)}
        hint={t('kpiResolutionHint')}
      />
      <CountTile
        index={4}
        label={t('kpiDau')}
        target={o.activeUsers.dau}
        hint={t('kpiWau', { wau: nf.format(o.activeUsers.wau) })}
        spark={<Sparkline values={o.activeUsers.spark} ariaLabel={t('kpiDau')} />}
      />
    </div>
  )
}

/**
 * Плитка со счётом значения. Хук вызывается здесь, а не в StatTile, чтобы
 * StatTile остался «глупым» и его можно было тестировать без анимации.
 */
function CountTile({
  label,
  target,
  hint,
  delta,
  spark,
  index,
  fractional = false,
  format,
}: {
  label: string
  /** null — данных нет (медиану не посчитать, если ничего не разобрали). */
  target: number | null
  hint?: string
  delta?: { text: string; good: boolean } | null
  spark?: ReactNode
  index: number
  fractional?: boolean
  format?: (value: number) => string
}) {
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const counted = useCountUp(target ?? 0, fractional)
  const text = target === null ? '—' : (format?.(counted) ?? nf.format(counted))

  return (
    <StatTile index={index} label={label} value={text} hint={hint} delta={delta} spark={spark} />
  )
}

// ── Панели ───────────────────────────────────────────────────────────────────

function GrowthPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const { hidden, toggle, focus, setFocus } = useSeriesToggle()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.usersGrowth(range),
    queryFn: () => fetchUsersGrowth(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const series = useSeries(q.data, GROWTH_KEYS, palette.series, hidden, t)
  const labels = useBucketLabels(q.data)

  return (
    <ChartPanel
      ref={ref}
      title={t('growthTitle')}
      subtitle={t('growthSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      {/* Легенда несёт значение (правило рельефа для слотов с низким контрастом)
          и переключает серии — иначе линии друг друга перекрывают. */}
      <ChartLegend
        className="mb-3"
        hidden={hidden}
        onToggle={toggle}
        onFocusChange={setFocus}
        items={series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          line: true,
          value: sum(s.values),
        }))}
      />
      <LineChart
        ariaLabel={t('growthTitle')}
        labels={labels}
        palette={palette}
        series={series}
        syncId={TIME_SYNC}
        focus={focus}
      />
    </ChartPanel>
  )
}

function ActiveUsersPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const { hidden, toggle, focus, setFocus } = useSeriesToggle()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.activeUsers(range),
    queryFn: () => fetchActiveUsers(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const series = useSeries(q.data, ACTIVE_KEYS, palette.series, hidden, t)
  const labels = useBucketLabels(q.data)

  return (
    <ChartPanel
      ref={ref}
      title={t('activeTitle')}
      subtitle={t('activeSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      <ChartLegend
        className="mb-3"
        hidden={hidden}
        onToggle={toggle}
        onFocusChange={setFocus}
        items={series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          line: true,
          value: last(s.values),
        }))}
      />
      <LineChart
        ariaLabel={t('activeTitle')}
        labels={labels}
        palette={palette}
        series={series}
        syncId={TIME_SYNC}
        focus={focus}
      />
    </ChartPanel>
  )
}

function UniversitiesPanel() {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.universitiesSize(),
    queryFn: fetchUniversitiesSize,
    enabled: inView,
    staleTime: STALE_MS,
  })

  const items = q.data?.items ?? []

  return (
    <ChartPanel
      ref={ref}
      title={t('sizeTitle')}
      subtitle={t('sizeSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      <BarChart
        ariaLabel={t('sizeTitle')}
        palette={palette}
        height={Math.max(180, items.length * 34 + 40)}
        labels={items.map((u) => u.name)}
        values={items.map((u) => u.total)}
      />
    </ChartPanel>
  )
}

function ComplaintsFlowPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const { hidden, toggle, focus, setFocus } = useSeriesToggle()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.complaintsFlow(range),
    queryFn: () => fetchComplaintsFlow(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const series = useSeries(q.data, FLOW_KEYS, palette.series, hidden, t)
  const labels = useBucketLabels(q.data)

  return (
    <ChartPanel
      ref={ref}
      title={t('flowTitle')}
      subtitle={t('flowSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      <ChartLegend
        className="mb-3"
        hidden={hidden}
        onToggle={toggle}
        onFocusChange={setFocus}
        items={series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          line: true,
          value: sum(s.values),
        }))}
      />
      <LineChart
        ariaLabel={t('flowTitle')}
        labels={labels}
        palette={palette}
        series={series}
        syncId={TIME_SYNC}
        focus={focus}
      />
    </ChartPanel>
  )
}

function LatencyPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.complaintsLatency(range),
    queryFn: () => fetchComplaintsLatency(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  return (
    <ChartPanel
      ref={ref}
      title={t('latencyTitle')}
      subtitle={t('latencySubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      <BarChart
        ariaLabel={t('latencyTitle')}
        palette={palette}
        height={220}
        labels={LATENCY_ORDER.map((k) => t(`latency_${k}`))}
        values={LATENCY_ORDER.map((k) => q.data?.buckets.find((b) => b.key === k)?.value ?? 0)}
      />
    </ChartPanel>
  )
}

function InvitesPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const { hidden, toggle, focus, setFocus } = useSeriesToggle()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.invitesFunnel(range),
    queryFn: () => fetchInvitesFunnel(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const labels = useBucketLabels(q.data?.series)
  const stacks = INVITE_STATUSES.map((key) => ({
    key,
    label: t(`invite_${key}`),
    color: inviteColor(key, palette),
    hidden: hidden.has(key),
    values: q.data?.series.series.find((s) => s.key === key)?.points.map((p) => p.value) ?? [],
  }))

  return (
    <ChartPanel
      ref={ref}
      title={t('invitesTitle')}
      subtitle={t('invitesSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
    >
      <Meter
        label={t('invitesConversion')}
        palette={palette}
        ratio={q.data?.conversion ?? 0}
        valueText={`${q.data?.conversion ?? 0}%`}
      />
      <ChartLegend
        className="mt-4 mb-3"
        hidden={hidden}
        onToggle={toggle}
        onFocusChange={setFocus}
        items={stacks.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          value: String(q.data?.byStatus.find((b) => b.key === s.key)?.value ?? 0),
        }))}
      />
      <StackedBarChart
        ariaLabel={t('invitesTitle')}
        labels={labels}
        palette={palette}
        height={200}
        series={stacks}
        totalLabel={t('tooltipTotal')}
        focus={focus}
      />
    </ChartPanel>
  )
}

function HeatmapPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.activityHeatmap(range),
    queryFn: () => fetchActivityHeatmap(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  return (
    <ChartPanel
      ref={ref}
      title={t('heatmapTitle')}
      subtitle={t('heatmapSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
      className="lg:col-span-2"
      skeletonHeight={200}
    >
      {q.data && (
        <ActivityGrid
          ariaLabel={t('heatmapTitle')}
          cells={q.data.cells}
          max={q.data.max}
          palette={palette}
          dayLabels={[0, 1, 2, 3, 4, 5, 6].map((d) => t(`weekday_${d}`))}
          cellTitle={(day, hour, value) => t('heatmapCell', { day, hour, value })}
        />
      )}
    </ChartPanel>
  )
}

function ActionsPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.topActions(range),
    queryFn: () => fetchTopActions(range),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const items = q.data?.items ?? []

  return (
    <ChartPanel
      ref={ref}
      title={t('actionsTitle')}
      subtitle={t('actionsSubtitle')}
      busy={q.isFetching}
      ready={inView && !!q.data}
      className="lg:col-span-2"
    >
      <BarChart
        ariaLabel={t('actionsTitle')}
        palette={palette}
        height={Math.max(180, items.length * 34 + 40)}
        labels={items.map((a) => a.action)}
        values={items.map((a) => a.value)}
      />
    </ChartPanel>
  )
}

// ── Общее ────────────────────────────────────────────────────────────────────

/**
 * Карточка графика. Полотно монтируется только когда карточка дошла до экрана
 * (`ready`): восемь canvas'ов и восемь запросов при открытии страницы — впустую,
 * видно от неё один-два. Пока данные перезапрашиваются, держим предыдущий
 * рендер под меньшей прозрачностью, без скелетона и скачка вёрстки.
 */
function ChartPanel({
  ref,
  title,
  subtitle,
  busy,
  ready,
  className,
  skeletonHeight = 260,
  children,
}: {
  ref: (node: HTMLDivElement | null) => void
  title: string
  subtitle: string
  busy?: boolean
  ready?: boolean
  className?: string
  skeletonHeight?: number
  children: ReactNode
}) {
  return (
    <Card ref={ref} className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent aria-busy={busy} className={cn('transition-opacity', busy && 'opacity-60')}>
        {ready ? children : <Skeleton className="w-full" style={{ height: skeletonHeight }} />}
      </CardContent>
    </Card>
  )
}

/**
 * Состояние легенды: скрытые серии (клик) и серия под курсором (наведение).
 * Клик — насовсем убрать линию из картины, наведение — на секунду выделить её
 * среди остальных. Две разные задачи, поэтому и два состояния.
 */
function useSeriesToggle(): {
  hidden: Set<string>
  toggle: (key: string) => void
  focus: string | null
  setFocus: (key: string | null) => void
} {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const toggle = (key: string): void =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  return { hidden, toggle, focus, setFocus }
}

/** Серии графика из ответа API: цвет по фиксированному слоту, подпись из i18n. */
function useSeries(
  data: MultiSeries | undefined,
  keys: readonly string[],
  colors: readonly string[],
  hidden: ReadonlySet<string>,
  t: (key: string) => string,
) {
  return useMemo(
    () =>
      keys.map((key, i) => ({
        key,
        label: t(`series_${key}`),
        // Цвет привязан к сущности, а не к порядку: скрытая серия не перекрашивает
        // остальные, потому что слот берётся по индексу ключа, а не по позиции в выборке.
        color: colors[i] ?? colors[0] ?? '#000000',
        hidden: hidden.has(key),
        values: data?.series.find((s) => s.key === key)?.points.map((p) => p.value) ?? [],
      })),
    [data, keys, colors, hidden, t],
  )
}

/**
 * Подписи корзин по локали. Формат считаем один раз на локаль: Intl.DateTimeFormat
 * дорог в создании, а точек на графике до 90.
 */
function useBucketLabels(data?: MultiSeries): string[] {
  const locale = useLocale()
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' })
    return data?.series[0]?.points.map((p) => fmt.format(new Date(p.at))) ?? []
  }, [data, locale])
}

function sum(values: number[]): string {
  return String(values.reduce((a, b) => a + b, 0))
}

function last(values: number[]): string {
  return String(values[values.length - 1] ?? 0)
}

/** Статусы инвайтов — состояния, поэтому статусная палитра, а не серии. */
function inviteColor(status: string, palette: ReturnType<typeof useChartTheme>['palette']): string {
  if (status === 'USED') return palette.status.good
  if (status === 'PENDING') return palette.status.warning
  if (status === 'EXPIRED') return palette.status.serious
  return palette.status.critical
}

/** Дельта медианы разбора: меньше — лучше, поэтому падение окрашено как хорошее. */
function deltaOf(
  r: { median: number | null; previousMedian: number | null },
  t: (key: string, values?: Record<string, string | number>) => string,
): { text: string; good: boolean } | null {
  if (r.median === null || r.previousMedian === null) return null
  const diff = Math.round((r.median - r.previousMedian) * 10) / 10
  if (diff === 0) return null
  return {
    text: t(diff < 0 ? 'deltaFaster' : 'deltaSlower', { h: Math.abs(diff) }),
    good: diff < 0,
  }
}
