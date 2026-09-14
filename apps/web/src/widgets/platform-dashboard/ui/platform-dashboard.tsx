'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  type UniversitySize,
  type PlatformRange,
} from '../../../entities/analytics'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Modal,
  PageHeader,
  SegmentedTabs,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import {
  DAY_GROUPS,
  HOUR_LABELS,
  WEEKDAYS,
  averageDay,
  useChartTheme,
  useSeriesToggle,
  weekdayAverages,
} from '../../../shared/ui/chart'
import { useInView } from './use-in-view'
import { Sparkline } from './sparkline'
import { ChartLegend, Meter, StatTile } from './primitives'
import { useCountUp } from '../../../shared/lib'

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

/**
 * Сколько вузов показываем в «Размере вузов» до раскрытия. Сервер отдаёт до 200,
 * и полный список превращал карточку в полосу высотой в три экрана — на дашборде
 * это не сравнение, а препятствие между графиками. Остальные доступны кнопкой.
 */
const TOP_UNIVERSITIES = 10

const LATENCY_ORDER = ['lt1h', 'lt4h', 'lt1d', 'lt3d', 'lt7d', 'gte7d'] as const
const INVITE_STATUSES = ['USED', 'PENDING', 'EXPIRED', 'REVOKED'] as const

// Наборы ключей серий — константы модуля, а не литералы в теле компонента:
// новый массив на каждый рендер обнулял бы useMemo внутри useSeries.
const GROWTH_KEYS = ['students', 'teachers', 'staff'] as const
const ACTIVE_KEYS = ['dau', 'wau'] as const
const FLOW_KEYS = ['created', 'resolved'] as const

const DAY_MS = 86_400_000

/**
 * Период по выбранному окну, выровненный по ГРАНИЦАМ КОРЗИН.
 *
 * Сервер раскладывает ряд по `date_trunc(interval, …)`, поэтому корзина, в которую
 * попала только часть периода, показывает не провал спроса, а свою неполноту. Раньше
 * правый край был «сейчас» — и каждая временная панель заканчивалась обрывом к нулю
 * (текущие сутки ещё идут). Обрыв читался как авария платформы. Поэтому:
 *
 * - правый край — конец последней ЗАВЕРШЁННОЙ корзины (вчера / прошлая неделя);
 * - левый край — НАЧАЛО корзины, а не «правый край минус N дней»: иначе тот же обрыв
 *   переезжает в начало графика, где первая корзина содержала бы миллисекунду.
 *
 * Живые числа за сегодня никуда не делись — они в плитках сверху, у них свои окна,
 * посчитанные на сервере.
 *
 * Побочная выгода: ключ запроса меняется раз в сутки (для недельного шага — раз в
 * неделю), а не раз в час, и кэш (клиентский и Redis) наконец переиспользуется.
 */
function useRange(rangeKey: RangeKey): PlatformRange {
  return useMemo(() => {
    const preset = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]
    const now = new Date()
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const bucketDays = preset.interval === 'week' ? 7 : 1
    // Начало текущей (ещё не закрытой) корзины. Неделя — с понедельника, как
    // date_trunc('week') в Postgres, поэтому воскресенье (getUTCDay() === 0)
    // сдвигаем на 6 дней назад, а не на ноль.
    const startOfBucket =
      preset.interval === 'week'
        ? startOfToday - ((now.getUTCDay() + 6) % 7) * DAY_MS
        : startOfToday
    // Целое число корзин, покрывающее окно: 90 дней недельным шагом — это 13 недель,
    // а не 12.86, иначе первая корзина обрезана.
    const buckets = Math.ceil(preset.days / bucketDays)
    const from = new Date(startOfBucket - buckets * bucketDays * DAY_MS)
    // Минус миллисекунда — правый край попадает в предыдущую, уже полную корзину.
    const to = new Date(startOfBucket - 1)
    return { from: from.toISOString(), to: to.toISOString(), interval: preset.interval }
  }, [rangeKey])
}

export function PlatformDashboard() {
  const t = useTranslations('PlatformDashboard')
  const tNav = useTranslations('Nav')
  const locale = useLocale()
  const [rangeKey, setRangeKey] = useState<RangeKey>(DEFAULT_RANGE)
  const range = useRange(rangeKey)

  // Границы окна показываем цифрами. «За выбранный период» не отвечает на вопрос
  // «за какой», а ответ здесь нужен: правый край — последняя завершённая корзина,
  // то есть не сегодня, и читатель должен видеть это, а не догадываться по оси.
  //
  // Зона — UTC, как и сами корзины: правый край это последняя миллисекунда суток,
  // и в местной зоне со сдвигом вперёд он назвался бы уже следующим днём — заголовок
  // разошёлся бы с последней подписью оси на единицу.
  const period = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).formatRange(new Date(range.from), new Date(range.to)),
    [locale, range],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка страницы (DESIGN_SYSTEM §10.1) — она же держит переключатель окна.
          Переключатель один на все панели: у каждой свой период графики показывали бы
          разные срезы рядом друг с другом. Плитки сверху ему не подчиняются — у них окна
          зафиксированы на сервере и подписаны в подсказке. Место — слот `actions`
          (справа), а не `tabs`: это фильтр периода, а не разделы страницы. */}
      <PageHeader
        title={tNav('dashboard')}
        subtitle={t('subtitleRange', { period })}
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
        <ActivityPanel range={range} />
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
        href="/platform-admin/universities"
      />
      <CountTile
        index={1}
        label={t('kpiUsers')}
        target={o.users.total}
        hint={t('kpiUsersHint')}
        spark={<Sparkline values={o.users.spark} ariaLabel={t('kpiUsersHint')} />}
        href="/platform-admin/users"
      />
      <CountTile
        index={2}
        label={t('kpiComplaints')}
        target={o.complaints.pending}
        hint={t('kpiComplaintsHint')}
        spark={<Sparkline values={o.complaints.spark} ariaLabel={t('kpiComplaintsHint')} />}
        href="/platform-admin/complaints"
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
        href="/platform-admin/stats"
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
  href,
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
  href?: string
  fractional?: boolean
  format?: (value: number) => string
}) {
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const counted = useCountUp(target ?? 0, fractional)
  const text = target === null ? '—' : (format?.(counted) ?? nf.format(counted))

  return (
    <StatTile
      index={index}
      label={label}
      value={text}
      hint={hint}
      delta={delta}
      spark={spark}
      href={href}
    />
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

/**
 * Размер вузов. На карточке — только десятка крупнейших: сравнивать сотню почти
 * равных полос никто не приходит, а развёрнутый список превращал панель в полосу
 * высотой в три экрана и отодвигал соседние графики за нижний край.
 *
 * Полный список открывается окном, а не раскрытием карточки на месте: раскрытие
 * сдвигало всё, что ниже, и читатель терял место, на которое смотрел. В окне у
 * списка своя прокрутка, а дашборд за ним остаётся неподвижным.
 */
function UniversitiesPanel() {
  const t = useTranslations('PlatformDashboard')
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const [open, setOpen] = useState(false)

  const q = useQuery({
    queryKey: platformAnalyticsKeys.universitiesSize(),
    queryFn: fetchUniversitiesSize,
    enabled: inView,
    staleTime: STALE_MS,
  })

  const all = q.data?.items ?? []
  const items = all.slice(0, TOP_UNIVERSITIES)
  const hasMore = all.length > TOP_UNIVERSITIES

  return (
    <>
      <ChartPanel
        ref={ref}
        title={t('sizeTitle')}
        subtitle={hasMore ? t('sizeSubtitleTop', { count: TOP_UNIVERSITIES }) : t('sizeSubtitle')}
        actions={
          hasMore && (
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              {t('showAll', { count: all.length })}
            </Button>
          )
        }
        busy={q.isFetching}
        ready={inView && !!q.data}
      >
        <BarChart
          ariaLabel={t('sizeTitle')}
          palette={palette}
          height={Math.max(180, items.length * 34 + 40)}
          labels={items.map((u) => u.name)}
          values={items.map((u) => u.total)}
          // Вузы отличаются на проценты: длина полос почти одинаковая, и без числа
          // панель не отвечает даже на вопрос «насколько больше».
          valueLabel={(v) => nf.format(v)}
        />
      </ChartPanel>
      {open && <UniversitiesModal items={all} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Полный список вузов. Та же диаграмма, что на карточке, но без потолка в десять
 * строк и со сводкой сверху: в карточке для сводки нет места, а открывают список
 * чаще всего как раз ради вопроса «сколько всего».
 */
function UniversitiesModal({ items, onClose }: { items: UniversitySize[]; onClose: () => void }) {
  const t = useTranslations('PlatformDashboard')
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const { palette } = useChartTheme()

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, u) => ({
          users: acc.users + u.total,
          students: acc.students + u.students,
          teachers: acc.teachers + u.teachers,
        }),
        { users: 0, students: 0, teachers: 0 },
      ),
    [items],
  )

  return (
    <Modal onClose={onClose} title={t('sizeTitle')} size="3xl">
      <p className="mb-3 text-xs text-muted-foreground">
        {t('sizeModalSummary', {
          count: items.length,
          users: nf.format(totals.users),
          students: nf.format(totals.students),
          teachers: nf.format(totals.teachers),
        })}
      </p>
      {/* `shrink-0`: тело окна — колонка с прокруткой, и без запрета на сжатие
          полотно ужалось бы до высоты окна вместо того, чтобы дать прокрутку. */}
      <div className="shrink-0">
        <BarChart
          ariaLabel={t('sizeTitle')}
          palette={palette}
          height={Math.max(180, items.length * 34 + 40)}
          labels={items.map((u) => u.name)}
          values={items.map((u) => u.total)}
          valueLabel={(v) => nf.format(v)}
        />
      </div>
    </Modal>
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
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
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
        valueLabel={(v) => nf.format(v)}
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

/**
 * Активность по времени. Раньше здесь была теплокарта 7×24, и она не работала:
 * распределение событий по клеткам почти ровное, поэтому 168 оттенков одного тона
 * читались как однотонное поле, число показывалось только по наведению, а часы
 * шли в UTC — «пик в 18» для Алматы означал 23:00.
 *
 * Вопрос, ради которого панель существует, — «когда платформой пользуются». На него
 * отвечает суточный профиль: величина закодирована положением по оси, а не оттенком,
 * и форма видна без наведения. Разрез «будни / выходные» — единственный, который в
 * этих данных даёт РАЗНЫЕ формы; остальные шесть кривых легли бы друг на друга.
 * Второй график рядом отвечает на второй вопрос — «какой день недели нагруженнее».
 *
 * Обе величины — среднее за сутки, а не сумма: будних дат в окне впятеро больше, и
 * суммы сравнивали бы размер группы, а не время активности.
 */
function ActivityPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const locale = useLocale()
  const { palette } = useChartTheme()
  const { ref, inView } = useInView<HTMLDivElement>()
  const { hidden, toggle, focus, setFocus } = useSeriesToggle()
  const tz = useTimeZone()

  const q = useQuery({
    queryKey: platformAnalyticsKeys.activityHeatmap(range, tz),
    queryFn: () => fetchActivityHeatmap(range, tz),
    enabled: inView,
    staleTime: STALE_MS,
  })

  const weekdays = useMemo(() => weekdayAverages(q.data), [q.data])

  // Среднее за сутки — величина дробная. На большой платформе дроби не нужны, но на
  // маленькой (события считаются десятками) округление до целого обратило бы весь ряд
  // в нули, поэтому точность выбирается по величине ряда, а не задаётся наперёд.
  const nf = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: Math.max(...weekdays, 0) < 10 ? 1 : 0,
      }),
    [locale, weekdays],
  )

  const series = useMemo(
    () =>
      DAY_GROUPS.map((group, i) => {
        const { days, hours } = averageDay(q.data, group.dows)
        return {
          key: group.key,
          label: t(`series_${group.key}`),
          // Цвет по индексу ключа, а не по позиции в выборке: выключенная серия
          // не перекрашивает оставшуюся.
          color: palette.series[i] ?? palette.series[0],
          hidden: hidden.has(group.key),
          days,
          values: hours,
        }
      })
        // Группа без дат в периоде — не «ноль событий», а «таких дней не было».
        // Плоская линия по нулю утверждала бы первое.
        .filter((s) => s.days > 0),
    [q.data, hidden, palette, t],
  )

  return (
    <ChartPanel
      ref={ref}
      title={t('activityTitle')}
      subtitle={t('activitySubtitle', { zone: zoneLabel(tz, locale) })}
      busy={q.isFetching}
      ready={inView && !!q.data}
      className="lg:col-span-2"
      skeletonHeight={280}
    >
      {/* Два разреза одних данных рядом: суточный профиль занимает вдвое больше
          ширины — у него 24 деления против семи. На узком экране встают в колонку. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
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
              // Итог средних суток: по нему видно, что выходные не просто «ниже
              // формой», а дают меньше событий за день.
              value: nf.format(s.values.reduce((a, b) => a + b, 0)),
            }))}
          />
          {/* `syncId` тут не нужен и вреден: по X часы, а не даты общего периода —
              курсор с временных панелей встал бы в чужую координату. */}
          <LineChart
            ariaLabel={t('activityTitle')}
            labels={HOUR_LABELS}
            palette={palette}
            series={series}
            height={240}
            focus={focus}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('activityByWeekday')}</p>
          <BarChart
            ariaLabel={t('activityByWeekday')}
            palette={palette}
            height={7 * 30 + 24}
            labels={WEEKDAYS.map((d) => t(`weekday_${d}`))}
            values={weekdays}
            // Дни отличаются на проценты — без числа полосы почти одинаковые.
            valueLabel={(v) => nf.format(v)}
          />
        </div>
      </div>
    </ChartPanel>
  )
}

function ActionsPanel({ range }: { range: PlatformRange }) {
  const t = useTranslations('PlatformDashboard')
  const locale = useLocale()
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale])
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
        valueLabel={(v) => nf.format(v)}
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
  actions,
  busy,
  ready,
  className,
  skeletonHeight = 260,
  children,
}: {
  ref: (node: HTMLDivElement | null) => void
  title: string
  subtitle: string
  /**
   * Управление панелью — в правом верхнем углу карточки, рядом с заголовком.
   * Внизу под графиком кнопке не место: до неё нужно проскроллить весь график,
   * то есть управление оказывается дальше, чем то, чем оно управляет.
   */
  actions?: ReactNode
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
        {/* CardAction — штатный слот шапки: он же переводит её в две колонки. */}
        {actions && <CardAction>{actions}</CardAction>}
      </CardHeader>
      <CardContent aria-busy={busy} className={cn('transition-opacity', busy && 'opacity-60')}>
        {ready ? children : <Skeleton className="w-full" style={{ height: skeletonHeight }} />}
      </CardContent>
    </Card>
  )
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
    // Зона — UTC: корзины сервер режет по UTC, и в зоне со сдвигом назад начало
    // корзины (00:00 UTC) называлось бы предыдущим днём — вся ось смещалась на сутки.
    const fmt = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    })
    return data?.series[0]?.points.map((p) => fmt.format(new Date(p.at))) ?? []
  }, [data, locale])
}

/**
 * Зона смотрящего. Определяется после монтирования, а не при первом рендере: на
 * сервере Intl вернёт зону контейнера (UTC), и разметка разошлась бы с клиентской.
 * До монтирования держим UTC — ровно то, что сервер отдаёт без параметра.
 */
function useTimeZone(): string {
  const [tz, setTz] = useState('UTC')
  useEffect(() => {
    try {
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (local) setTz(local)
    } catch {
      // Зона браузеру недоступна — остаёмся на UTC.
    }
  }, [])
  return tz
}

/**
 * Короткая подпись зоны («GMT+5») — её и показываем в подзаголовке. Полное имя
 * зоны («Asia/Almaty») отвечает на вопрос «где», а читателю нужен ответ на вопрос
 * «на сколько сдвинуты часы на оси».
 */
function zoneLabel(tz: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz
  } catch {
    // shortOffset — ES2022; в старом движке остаётся имя зоны.
    return tz
  }
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
