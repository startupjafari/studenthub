'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import {
  Briefcase,
  Building2,
  ClipboardCheck,
  Clock,
  KeyRound,
  Search,
  TimerReset,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  careerEventKeys,
  fetchUniversityCareerAnalytics,
  FUNNEL_STAGES,
  type UniversityCareerAnalytics,
} from '../../../entities/career-event'
import {
  CareerUniversityPicker,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { useAppSelector } from '../../../shared/store'
import { cn } from '../../../shared/lib/utils'
import {
  EmptyState,
  MetricTile,
  PageHeader,
  Progress,
  SectionPanel,
  Skeleton,
} from '../../../shared/ui'
import { ChartLegend, useChartTheme, type ChartPalette } from '../../../shared/ui/chart'

// Тяжёлый recharts — только на клиенте, со скелетоном (FRONTEND_RULES §4, §11).
const BarChart = dynamic(() => import('../../../shared/ui/chart/bar-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
})

const LineChart = dynamic(() => import('../../../shared/ui/chart/line-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
})

/** Роли, которым /career открывает карьерный центр вуза, а не витрину соискателя. */
const STAFF_ROLES: Role[] = [
  Role.TEACHER,
  Role.DEAN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
]

const COMPANIES_HREF = '/career/companies'
const REVIEW_HREF = '/career/vacancy-review'

export function CareerView() {
  const role = useAppSelector((s) => s.auth.role)
  return role !== null && STAFF_ROLES.includes(role) ? <StaffOverview /> : <SeekerOverview />
}

/**
 * Обзор карьерного центра: сводка по выбранному вузу и вход в разделы. Раньше здесь стояла
 * заглушка «модуль в разработке» — она пережила сам модуль, и сотрудник вуза видел пустой
 * экран вместо точки входа в разделы, которые уже работают.
 */
function StaffOverview() {
  const t = useTranslations('CareerAdmin')
  const tA = useTranslations('CareerAnalytics')
  const format = useFormatter()
  const { needsPick, universityId } = useCareerUniversity()

  const analytics = useQuery({
    queryKey: careerEventKeys.universityAnalytics(universityId),
    queryFn: () => fetchUniversityCareerAnalytics(universityId ?? undefined),
    enabled: !needsPick || !!universityId,
  })

  const d = analytics.data
  const { palette } = useChartTheme()

  // Воронка: подписи берём из словаря аналитики, порядок — как в самой воронке.
  // Значения — «дошло до шага», а не «лежит сейчас»: см. комментарий в API.
  const funnelLabels = FUNNEL_STAGES.map((k) => tA(`funnel_${k}`))
  const funnelValues = FUNNEL_STAGES.map((k) => d?.reached[k] ?? 0)

  const VACANCY_STATES = ['PENDING', 'APPROVED', 'REJECTED'] as const
  const vacancyLabels = [t('statusPending'), t('statusApproved'), t('statusRejected')]
  const vacancyValues = VACANCY_STATES.map((k) => d?.vacancies[k] ?? 0)

  const weekLabels = (d?.weekly.weeks ?? []).map((iso) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short' }),
  )
  const weeklyEmpty = (d?.weekly.submitted ?? []).every((v) => v === 0)

  // Пустой выбор вуза занимает экран целиком (flex-1 центрирует подсказку), а сводка
  // длиннее экрана и обязана скроллиться в `main`. Оставить `flex-1 min-h-0` для обоих
  // нельзя: во втором случае панели сжимаются до высоты шапки вместо переполнения —
  // «Требует внимания» и «Отклики по неделям» схлопывались в полоску.
  const empty = needsPick && !universityId

  return (
    <div className={cn('flex w-full flex-col gap-4', empty && 'min-h-0 flex-1')}>
      <PageHeader
        title={t('overviewTitle')}
        subtitle={t('overviewSubtitle')}
        actions={<CareerUniversityPicker />}
      />

      {empty ? (
        // Обзор — единственное место выбора вуза: остальные разделы берут его отсюда,
        // поэтому здесь стоит не заглушка «выберите в другом месте», а сам выбор.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Building2 className="size-6" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">{t('pickUniversity')}</h3>
            <p className="max-w-sm text-sm text-muted-foreground">{t('pickHint')}</p>
          </div>
          <div className="w-64">
            <CareerUniversityPicker />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {!d
              ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
              : [
                  {
                    icon: Building2,
                    label: tA('companiesApproved'),
                    value: d.companies.APPROVED ?? 0,
                    tone: undefined,
                  },
                  {
                    icon: ClipboardCheck,
                    label: t('statusPending'),
                    value: d.vacancies.PENDING ?? 0,
                    tone: 'text-warning',
                  },
                  {
                    icon: Search,
                    label: tA('vacanciesApproved'),
                    value: d.vacancies.APPROVED ?? 0,
                    tone: 'text-info',
                  },
                  {
                    icon: Briefcase,
                    label: tA('applications'),
                    value: d.reached.SUBMITTED,
                    tone: 'text-success',
                  },
                ].map((m, i) => (
                  <MetricTile
                    key={m.label}
                    index={i}
                    icon={m.icon}
                    tone={m.tone}
                    label={m.label}
                    value={m.value}
                  />
                ))}
          </div>

          {/* Счётчик без срока ничего не требует: «2 на модерации» — это состояние,
              а «старейшая ждёт 6 дней» — уже задача. Поэтому у каждой строки есть
              срок и переход к самим данным. */}
          <SectionPanel
            title={tA('queueTitle')}
            subtitle={tA('queueHint')}
            // Медиана решения относится ко всей очереди, а не к отдельной строке —
            // поэтому стоит в шапке панели, а не подписью под одним числом.
            actions={
              d && d.queue.medianDecisionHours !== null ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {tA('queueMedian', { hours: d.queue.medianDecisionHours })}
                </span>
              ) : undefined
            }
          >
            {!d ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                <QueueItem
                  href={REVIEW_HREF}
                  icon={ClipboardCheck}
                  label={t('statusPending')}
                  value={d.queue.vacanciesPending}
                  tone="text-warning"
                  hint={
                    d.queue.oldestPendingDays === null
                      ? tA('queueEmpty')
                      : tA('queueOldest', { days: d.queue.oldestPendingDays })
                  }
                />
                <QueueItem
                  href={COMPANIES_HREF}
                  icon={KeyRound}
                  label={tA('queueRequests')}
                  value={d.queue.companiesRequested}
                  tone="text-info"
                  hint={tA('queueRequestsHint')}
                />
                <QueueItem
                  href={COMPANIES_HREF}
                  icon={TimerReset}
                  label={tA('queueExpiring')}
                  value={d.queue.accessExpiringSoon}
                  tone="text-destructive"
                  hint={tA('queueExpiringHint', { days: d.queue.expiringDays })}
                />
                <QueueItem
                  icon={Clock}
                  label={tA('queueStale')}
                  value={d.queue.staleApplications}
                  tone="text-destructive"
                  hint={tA('queueStaleHint', { days: d.queue.staleDays })}
                />
              </div>
            )}
          </SectionPanel>

          {/* Разрезы, а не плитки-ссылки: ссылки дублировали бы сайдбар, а дашборд должен
              отвечать на вопрос «что происходит», а не повторять навигацию. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionPanel title={tA('chartFunnel')} subtitle={tA('chartFunnelHint')}>
              {!d ? (
                <Skeleton className="h-56 w-full" />
              ) : funnelValues.every((v) => v === 0) ? (
                <EmptyState title={tA('noData')} className="border-0 p-6" />
              ) : (
                <BarChart
                  ariaLabel={tA('chartFunnel')}
                  palette={palette}
                  height={220}
                  labels={funnelLabels}
                  values={funnelValues}
                  seriesName={tA('applications')}
                />
              )}
            </SectionPanel>

            <SectionPanel title={tA('chartVacancies')} subtitle={tA('chartVacanciesHint')}>
              {!d ? (
                <Skeleton className="h-56 w-full" />
              ) : vacancyValues.every((v) => v === 0) ? (
                <EmptyState title={tA('noData')} className="border-0 p-6" />
              ) : (
                <BarChart
                  ariaLabel={tA('chartVacancies')}
                  palette={palette}
                  height={220}
                  labels={vacancyLabels}
                  values={vacancyValues}
                  seriesName={tA('vacanciesApproved')}
                />
              )}
            </SectionPanel>
          </div>

          {/* Итог за всё время не показывает, стало ли лучше. Недельный ряд показывает. */}
          <SectionPanel title={tA('chartWeekly')} subtitle={tA('chartWeeklyHint')}>
            {!d ? (
              <Skeleton className="h-56 w-full" />
            ) : weeklyEmpty ? (
              <EmptyState title={tA('noData')} className="border-0 p-6" />
            ) : (
              <LineChart
                ariaLabel={tA('chartWeekly')}
                palette={palette}
                height={220}
                labels={weekLabels}
                series={[
                  {
                    key: 'submitted',
                    label: tA('weeklySubmitted'),
                    color: palette.series[0],
                    values: d.weekly.submitted,
                  },
                  {
                    key: 'interview',
                    label: tA('weeklyInterview'),
                    color: palette.series[1],
                    values: d.weekly.interview,
                  },
                  {
                    key: 'hired',
                    label: tA('weeklyHired'),
                    color: palette.series[2],
                    values: d.weekly.hired,
                  },
                ]}
              />
            )}
          </SectionPanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionPanel title={tA('chartSkills')} subtitle={tA('chartSkillsHint')}>
              {!d ? (
                <Skeleton className="h-40 w-full" />
              ) : d.skills.length === 0 ? (
                <EmptyState title={tA('noData')} className="border-0 p-6" />
              ) : (
                <SkillsGap skills={d.skills} palette={palette} />
              )}
            </SectionPanel>

            <SectionPanel title={tA('ratesTitle')} subtitle={tA('ratesHint')}>
              {!d ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ul className="flex flex-col gap-3">
                  {[
                    { label: tA('rateInterview'), value: d.rates.interview },
                    { label: tA('rateOffer'), value: d.rates.offer },
                    { label: tA('rateHired'), value: d.rates.hired },
                  ].map((r) => (
                    <li key={r.label} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-sm text-muted-foreground">{r.label}</span>
                      <Progress value={r.value ?? 0} className="flex-1" />
                      <span className="w-12 shrink-0 text-right text-sm tabular-nums">
                        {r.value == null ? '—' : `${r.value}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionPanel>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Строка очереди: число, что это, и срок под ним. Ноль не красится тревожным тоном —
 * пустая очередь это хорошая новость, а не предупреждение.
 */
function QueueItem({
  href,
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  /** Задан — строка ведёт к самим данным. Без него это просто показатель. */
  href?: string
  icon: typeof ClipboardCheck
  label: string
  value: number
  hint: string
  tone: string
}) {
  const body = (
    <>
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10',
          value > 0 ? tone : 'text-muted-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-xl leading-tight font-semibold tabular-nums">{value}</span>
          <span className="truncate text-sm text-muted-foreground">{label}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground/80">{hint}</span>
      </span>
    </>
  )
  const className = 'flex items-center gap-3 rounded-lg px-2 py-2'
  return href ? (
    <Link
      href={href}
      className={cn(
        className,
        'outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  )
}

/**
 * Спрос против предложения по навыкам: две полосы на строку, обе — доли.
 *
 * Сравнивать штуки нельзя: «2 вакансии» и «296 студентов» на общей шкале превращают
 * спрос в невидимую полоску, а на раздельных — врут, будто величины равны. Сравнима
 * доля: «две трети вакансий требуют React, указали его 0% студентов».
 */
function SkillsGap({
  skills,
  palette,
}: {
  skills: UniversityCareerAnalytics['skills']
  palette: ChartPalette
}) {
  const tA = useTranslations('CareerAnalytics')

  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { key: 'demand', label: tA('skillsDemand'), color: palette.series[0] },
          { key: 'supply', label: tA('skillsSupply'), color: palette.series[2] },
        ]}
      />
      <ul className="flex flex-col gap-2.5">
        {skills.map((s) => (
          <li
            key={s.skill}
            className="flex items-center gap-3"
            // Штуки за долями: доля отвечает «насколько это общий дефицит», числа —
            // «на каком объёме это посчитано». Второе нужно реже, поэтому в подсказке.
            title={tA('skillsCounts', { demand: s.demand, supply: s.supply })}
          >
            <span className="w-28 shrink-0 truncate text-sm">{s.skill}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <SkillBar share={s.demandShare} color={palette.series[0]} />
              <SkillBar share={s.supplyShare} color={palette.series[2]} />
            </span>
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {formatShare(s.demandShare)} / {formatShare(s.supplyShare)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Прочерк, а не «0%»: доли нет, когда делить не на что (ни одной вакансии, ни одного студента). */
function formatShare(share: number | null): string {
  return share === null ? '—' : `${share}%`
}

function SkillBar({ share, color }: { share: number | null; color: string }) {
  // Ноль — пустой трек: полоска «на всякий случай» читалась бы как «немного есть».
  const width = share === null || share === 0 ? 0 : Math.max(2, share)
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="block h-full rounded-full"
        style={{ width: `${width}%`, backgroundColor: color }}
      />
    </span>
  )
}

/** Витрина соискателя (студент, староста) — разделы поиска работы появятся отдельной задачей. */
function SeekerOverview() {
  const t = useTranslations('Products')
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('career.title')} subtitle={t('career.hint')} />
      <EmptyState
        icon={<Briefcase className="size-6" aria-hidden />}
        title={t('career.soonTitle')}
        description={t('career.soonText')}
      />
    </div>
  )
}
