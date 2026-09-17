'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { Briefcase, Building2, Download, FileText, UserCheck } from 'lucide-react'
import type { CareerReportPeriod } from '@studenthub/shared-schemas'
import {
  careerEventKeys,
  exportCareerReport,
  fetchCareerReport,
} from '../../../entities/career-event'
import {
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  Progress,
  SectionPanel,
  SegmentedTabs,
  Skeleton,
} from '../../../shared/ui'
import { ChartLegend, useChartTheme, type ChartPalette } from '../../../shared/ui/chart'
import {
  CareerUniversityRequired,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { saveFile, toApiError } from '../../../shared/lib'
import { toast } from 'sonner'

// Тяжёлый recharts — только на клиенте, со скелетоном (FRONTEND_RULES §4, §11).
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
})

const PERIODS: CareerReportPeriod[] = ['month', 'quarter', 'year']

/**
 * Метрики карьеры — аналитический экран за период.
 *
 * Разведён с «Обзором» по назначению: там операционная сводка «что делать сегодня»,
 * здесь разрезы за период и выгрузка. Раньше страница повторяла плитки обзора и его же
 * конверсию — то есть не отвечала ни на один вопрос, которого нет на обзоре.
 *
 * Только агрегаты. Разрез по факультетам дополнительно закрыт порогом малых групп:
 * «на факультете четверо, трудоустроен один» — это уже сведения о человеке.
 */
export function CareerAnalyticsView() {
  const t = useTranslations('CareerReport')
  const tA = useTranslations('CareerAnalytics')
  const tErr = useTranslations('Errors')
  const format = useFormatter()
  const locale = useLocale()
  const { palette } = useChartTheme()
  const { needsPick, universityId } = useCareerUniversity()
  const [period, setPeriod] = useState<CareerReportPeriod>('quarter')

  const query = useQuery({
    queryKey: careerEventKeys.report(universityId, period),
    queryFn: () => fetchCareerReport(period, universityId ?? undefined),
    enabled: !needsPick || !!universityId,
    // Прошлый период остаётся на экране, пока грузится новый: иначе переключение
    // периода каждый раз обнуляет страницу в скелетон.
    placeholderData: keepPreviousData,
  })

  const download = useMutation({
    mutationFn: () => exportCareerReport(period, universityId ?? undefined, locale),
    onSuccess: saveFile,
    onError: (e) => toast.error(tErr(toApiError(e).code)),
  })

  const d = query.data

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={t('subtitle')}
      tabs={
        <SegmentedTabs<CareerReportPeriod>
          aria-label={t('periodLabel')}
          items={PERIODS.map((p) => ({ value: p, label: t(`period_${p}`) }))}
          value={period}
          onChange={setPeriod}
        />
      }
      actions={
        <Button
          size="md"
          variant="outline"
          onClick={() => download.mutate()}
          disabled={!d || download.isPending}
        >
          <Download className="size-4" aria-hidden />
          {t('export')}
        </Button>
      }
    />
  )

  // Шапка рисуется в любом случае: без неё платформенной роли негде выбрать вуз.
  if (needsPick && !universityId) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        {header}
        <CareerUniversityRequired />
      </div>
    )
  }

  if (query.isError) {
    return (
      // Как и в ветке выбора вуза выше: плашка — единственное содержимое, колонка
      // должна отдать ей всю свободную высоту.
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        {header}
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      </div>
    )
  }

  const dash = tA('noData')
  const num = (v: number | null | undefined) => (v == null ? dash : format.number(v))
  const pct = (v: number | null | undefined) => (v == null ? dash : `${v}%`)

  return (
    <div className="flex w-full flex-col gap-4">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!d
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : [
              {
                icon: FileText,
                tone: 'text-warning',
                label: tA('applications'),
                pair: d.totals.applications,
              },
              {
                icon: UserCheck,
                tone: 'text-success',
                label: tA('hired'),
                pair: d.totals.hired,
              },
              {
                icon: Briefcase,
                tone: 'text-info',
                label: t('newVacancies'),
                pair: d.totals.vacancies,
              },
              {
                icon: Building2,
                tone: undefined,
                label: t('newCompanies'),
                pair: d.totals.companies,
              },
            ].map((m, i) => (
              <MetricTile
                key={m.label}
                index={i}
                icon={m.icon}
                tone={m.tone}
                label={m.label}
                value={m.pair.value}
                delta={deltaOf(m.pair.value, m.pair.previous)}
              />
            ))}
      </div>

      {/* Скорость — то, что чувствует студент. Объём откликов без времени ответа
          описывает активность, а не работу карьерного центра. */}
      <SectionPanel title={t('speedTitle')} subtitle={t('speedHint')}>
        {!d ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure
              value={
                d.timing.firstResponseHours === null ? dash : String(d.timing.firstResponseHours)
              }
              unit={t('unitHours')}
              label={t('firstResponse')}
            />
            <Figure
              value={d.timing.hireDays === null ? dash : String(d.timing.hireDays)}
              unit={t('unitDays')}
              label={t('timeToHire')}
            />
            <Figure
              value={pct(d.timing.silentShare)}
              label={t('silent')}
              hint={t('silentHint', { count: d.timing.silent, total: d.timing.total })}
            />
          </div>
        )}
      </SectionPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Воронка отвечает «сколько дошло», потери — «где именно теряем». */}
        <SectionPanel title={t('dropoffTitle')} subtitle={t('dropoffHint')}>
          {!d ? (
            <Skeleton className="h-56 w-full" />
          ) : d.funnel.stages.SUBMITTED === 0 ? (
            <EmptyState title={dash} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('dropoffTitle')}
              palette={palette}
              height={220}
              labels={d.funnel.dropoff.map((s) => tA(`funnel_${s.from}`))}
              values={d.funnel.dropoff.map((s) => s.lost)}
              seriesName={t('lost')}
            />
          )}
        </SectionPanel>

        <SectionPanel title={t('outcomesTitle')} subtitle={t('outcomesHint')}>
          {!d ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ShareRows
              rows={[
                { label: tA('hired'), value: d.outcomes.hired },
                { label: t('rejected'), value: d.outcomes.rejected },
                { label: t('withdrawn'), value: d.outcomes.withdrawn },
                { label: t('active'), value: d.outcomes.active },
              ]}
              total={d.outcomes.total}
              palette={palette}
            />
          )}
        </SectionPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel
          title={t('facultiesTitle')}
          subtitle={
            d && d.faculties.suppressed > 0
              ? t('facultiesSuppressed', {
                  count: d.faculties.suppressed,
                  min: d.faculties.minCell,
                })
              : t('facultiesHint')
          }
        >
          {!d ? (
            <Skeleton className="h-56 w-full" />
          ) : d.faculties.items.length === 0 ? (
            <EmptyState title={dash} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('facultiesTitle')}
              palette={palette}
              height={Math.max(160, d.faculties.items.length * 28)}
              labels={d.faculties.items.map((f) => f.name)}
              values={d.faculties.items.map((f) => f.hired)}
              seriesName={tA('hired')}
              valueLabel={(v) => format.number(v)}
            />
          )}
        </SectionPanel>

        <SectionPanel title={t('graduatesTitle')} subtitle={t('graduatesHint')}>
          {!d ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              <Figure
                value={pct(d.graduates.share)}
                label={t('graduatesShare', { year: d.graduates.year })}
                hint={t('graduatesCounts', {
                  hired: d.graduates.hired,
                  students: d.graduates.students,
                })}
              />
              <Progress value={d.graduates.share ?? 0} />
            </div>
          )}
        </SectionPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel title={t('companiesTitle')} subtitle={t('companiesHint')}>
          {!d ? (
            <Skeleton className="h-56 w-full" />
          ) : d.companies.length === 0 ? (
            <EmptyState title={dash} className="border-0 p-6" />
          ) : (
            <BarChart
              ariaLabel={t('companiesTitle')}
              palette={palette}
              height={Math.max(160, d.companies.length * 28)}
              labels={d.companies.map((c) => c.name)}
              values={d.companies.map((c) => c.hired)}
              seriesName={tA('hired')}
              valueLabel={(v) => format.number(v)}
            />
          )}
        </SectionPanel>

        <SectionPanel title={t('marketTitle')} subtitle={t('marketHint')}>
          {!d ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <CutRows
                title={t('cutEmployment')}
                map={d.vacancyCuts.employment}
                labels={(k) => t(`employment_${k}`)}
                palette={palette}
              />
              <CutRows
                title={t('cutFormat')}
                map={d.vacancyCuts.format}
                labels={(k) => t(`format_${k}`)}
                palette={palette}
              />
              <CutRows
                title={t('cutExperience')}
                map={d.vacancyCuts.experience}
                labels={(k) => t(`experience_${k}`)}
                palette={palette}
              />
              <CutRows
                title={t('cutCities')}
                map={Object.fromEntries(d.vacancyCuts.cities.map((c) => [c.city, c.count]))}
                labels={(k) => k}
                palette={palette}
              />
            </div>
          )}
        </SectionPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel title={t('salaryTitle')} subtitle={t('salaryHint')}>
          {!d ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              <SalaryRow
                label={t('salaryOffered')}
                min={d.salary.offeredMin}
                max={d.salary.offeredMax}
                currency={d.salary.currency}
                dash={dash}
              />
              <SalaryRow
                label={t('salaryDesired')}
                min={d.salary.desiredMin}
                max={d.salary.desiredMax}
                currency={d.salary.currency}
                dash={dash}
              />
              <p className="text-xs text-muted-foreground">
                {t('deadVacancies', {
                  dead: d.deadVacancies.dead,
                  shown: d.deadVacancies.shown,
                })}
              </p>
            </div>
          )}
        </SectionPanel>

        <SectionPanel title={t('readinessTitle')} subtitle={t('readinessHint')}>
          {!d ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <ShareRows
                rows={d.students.readiness.buckets.map((n, i) => ({
                  label: t('readinessBucket', {
                    from: i === 0 ? 0 : (d.students.readiness.edges[i - 1] ?? 0) + 1,
                    to: d.students.readiness.edges[i] ?? 100,
                  }),
                  value: n,
                }))}
                total={d.students.readiness.buckets.reduce((a, b) => a + b, 0)}
                palette={palette}
              />
              <ShareRows
                rows={['LOOKING', 'OPEN', 'NOT_LOOKING'].map((k) => ({
                  label: t(`seeker_${k}`),
                  value: d.students.seekers[k] ?? 0,
                }))}
                total={Object.values(d.students.seekers).reduce((a, b) => a + b, 0)}
                palette={palette}
              />
            </div>
          )}
        </SectionPanel>
      </div>

      <SectionPanel title={t('profilesTitle')} subtitle={t('profilesHint')}>
        {!d ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure
              value={pct(d.students.profiles.share)}
              label={t('profilesOpen')}
              hint={tA('profilesText', {
                visible: d.students.profiles.visible,
                total: d.students.profiles.total,
              })}
            />
            <Figure
              value={num(d.students.profiles.openedInPeriod)}
              label={t('profilesOpened')}
              hint={t('inPeriod')}
            />
            <Figure
              value={num(d.students.resumesPublished)}
              label={t('resumes')}
              hint={t('resumesHint')}
            />
          </div>
        )}
      </SectionPanel>
    </div>
  )
}

/** Крупное число с подписью: показатель, который читают первым, а не ищут в строке. */
function Figure({
  value,
  unit,
  label,
  hint,
}: {
  value: string
  unit?: string
  label: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1">
        <span className="text-2xl leading-tight font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </span>
      <span className="text-sm">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

/**
 * Строки «часть от целого»: подпись, полоса, число и доля. Доля считается от общего
 * числа, а не от максимума строки: здесь сравниваются части одного целого.
 */
function ShareRows({
  rows,
  total,
  palette,
}: {
  rows: { label: string; value: number }[]
  total: number
  palette: ChartPalette
}) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const share = total === 0 ? 0 : Math.round((r.value / total) * 100)
        return (
          <li key={r.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm text-muted-foreground">{r.label}</span>
            <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${r.value === 0 ? 0 : Math.max(2, share)}%`,
                  backgroundColor: palette.series[0],
                }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {r.value} · {total === 0 ? '—' : `${share}%`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Разрез витрины: заголовок и строки долей. Пустой разрез не рисуется вовсе. */
function CutRows({
  title,
  map,
  labels,
  palette,
}: {
  title: string
  map: Record<string, number>
  labels: (key: string) => string
  palette: ChartPalette
}) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  return (
    <div className="flex flex-col gap-2">
      <ChartLegend items={[{ key: title, label: title, color: palette.series[0] }]} />
      <ShareRows
        rows={entries.map(([key, value]) => ({ label: labels(key), value }))}
        total={total}
        palette={palette}
      />
    </div>
  )
}

/** Вилка «от — до». Прочерк там, где вилку никто не указал. */
function SalaryRow({
  label,
  min,
  max,
  currency,
  dash,
}: {
  label: string
  min: number | null
  max: number | null
  currency: string | null
  dash: string
}) {
  const format = useFormatter()
  const text =
    min === null && max === null
      ? dash
      : `${min === null ? dash : format.number(min)} — ${max === null ? dash : format.number(max)}${
          currency ? ` ${currency}` : ''
        }`
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{text}</span>
    </div>
  )
}

/**
 * Дельта к прошлому периоду. Рост здесь всегда хорошая новость: и отклики, и найм, и
 * новые вакансии, и новые компании — величины, которые вуз хочет видеть растущими.
 */
function deltaOf(value: number, previous: number): { text: string; good: boolean } | null {
  if (previous === 0) return null
  const change = Math.round(((value - previous) / previous) * 100)
  if (change === 0) return null
  return { text: `${change > 0 ? '+' : ''}${change}%`, good: change > 0 }
}
