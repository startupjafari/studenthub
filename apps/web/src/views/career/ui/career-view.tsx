'use client'

import { useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Clock,
  FileText,
  Handshake,
  KeyRound,
  MapPin,
  Search,
  Send,
  TimerReset,
  Video,
} from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import {
  careerEventKeys,
  fetchCareerEvents,
  fetchUniversityCareerAnalytics,
  FUNNEL_STAGES,
  type CareerEvent,
  type UniversityCareerAnalytics,
} from '../../../entities/career-event'
import {
  applicationKeys,
  fetchMyApplications,
  type StudentApplication,
} from '../../../entities/career-application'
import { searchVacancies, vacancyKeys, type Vacancy } from '../../../entities/vacancy'
import { fetchResumeSettings, resumeKeys } from '../../../entities/resume'
import {
  CareerUniversityPicker,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { careerHomeFor } from '../../../widgets/app-shell'
import { useAppSelector } from '../../../shared/store'
import { cn } from '../../../shared/lib/utils'
import {
  Badge,
  Button,
  EmptyState,
  MetricTile,
  PageHeader,
  PageLoader,
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

/**
 * Роли, которым /career открывает карьерный центр вуза, а не витрину соискателя.
 *
 * Преподавателя здесь нет: сводка вуза строится на `GET /career/analytics/university`,
 * куда API его не пускает, — он видел бы не обзор, а отказ. Ему открыты только витрина
 * вакансий и карьерные события (nav.ts, CAREER_TEACHER_NAV).
 */
const STAFF_ROLES: Role[] = [
  Role.DEAN,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
]

const COMPANIES_HREF = '/career/companies'
const REVIEW_HREF = '/career/vacancy-review'

export function CareerView() {
  const tCommon = useTranslations('Common')
  const role = useAppSelector((s) => s.auth.role)
  const router = useRouter()

  // Преподавателю показать на корне нечего: обзор — это метрики вуза, куда API его не
  // пускает (PROJECT.md §694), а витрина соискателя не про него — он видел заглушку
  // «карьерный модуль в разработке» без единой ссылки. Ведём в первый раздел, который
  // ему открыт; тот же адрес стоит за входом в «Карьеру» в переключателе продуктов.
  const home = careerHomeFor(role ?? undefined)
  const redirecting = home !== '/career'
  useEffect(() => {
    if (redirecting) router.replace(home)
  }, [redirecting, home, router])

  if (redirecting) return <PageLoader label={tCommon('loading')} />
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
                // Та же заготовка, что у соседней панели «Дефицит навыков»: обе карточки
                // стоят в одной строке сетки и растягиваются по высоте до самой высокой,
                // поэтому и заготовка у них общая — иначе одна закрыта целиком, а вторая
                // висит короткой плашкой посреди пустой карточки.
                <Skeleton className="h-40 w-full" />
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
      <ul className="flex flex-col gap-2">
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
/**
 * Обзор соискателя: что происходит с откликами, куда смотреть дальше.
 *
 * Здесь тоже стояла заглушка «модуль в разработке» — при том что студенту уже открыты
 * вакансии, отклики, карьерный профиль, резюме и мероприятия. Обзор отвечает на три
 * вопроса: как идут мои отклики, что нового на витрине и куда сходить.
 *
 * Данные — те же эндпоинты, что у соответствующих разделов, поэтому переход из обзора
 * в раздел открывает уже прогретый кэш.
 */
function SeekerOverview() {
  const t = useTranslations('Products')
  const tHome = useTranslations('CareerHome')
  const tApp = useTranslations('CareerApplications')

  // limit=100: сводка считается по всем откликам, а не по первой странице. Больше сотни
  // активных откликов у студента — случай, которого не бывает; список здесь не рисуем.
  const APPS = { page: 1, limit: 100 } as const
  const VACANCIES = { page: 1, limit: 5 } as const
  const EVENTS = { page: 1, limit: 3 } as const

  const appsQ = useQuery({
    queryKey: applicationKeys.mine(APPS),
    queryFn: () => fetchMyApplications(APPS),
  })
  const vacQ = useQuery({
    queryKey: vacancyKeys.search(VACANCIES),
    queryFn: () => searchVacancies(VACANCIES),
  })
  const eventsQ = useQuery({
    queryKey: careerEventKeys.list(EVENTS),
    queryFn: () => fetchCareerEvents(EVENTS),
  })
  const resumeQ = useQuery({
    queryKey: resumeKeys.mine(),
    queryFn: fetchResumeSettings,
    retry: false,
  })

  const stats = useMemo(() => {
    const items = appsQ.data?.items ?? []
    const isActive = (a: StudentApplication): boolean =>
      a.status !== 'REJECTED' && a.status !== 'WITHDRAWN' && a.status !== 'HIRED'
    return {
      active: items.filter(isActive).length,
      interview: items.filter((a) => a.status === 'INTERVIEW' || a.status === 'OFFER').length,
      hired: items.filter((a) => a.status === 'HIRED').length,
    }
  }, [appsQ.data])

  const resume = resumeQ.data

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('career.title')} subtitle={t('career.hint')} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          index={0}
          icon={Send}
          label={tHome('statsActive')}
          value={appsQ.isLoading ? null : stats.active}
        />
        <MetricTile
          index={1}
          icon={ClipboardCheck}
          tone="text-info"
          label={tHome('statsInterview')}
          value={appsQ.isLoading ? null : stats.interview}
        />
        <MetricTile
          index={2}
          icon={Handshake}
          tone="text-success"
          label={tHome('statsHired')}
          value={appsQ.isLoading ? null : stats.hired}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionPanel
          title={tHome('freshVacancies')}
          subtitle={tHome('freshVacanciesHint')}
          actions={
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/career/vacancies">
                {tHome('openAll')}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          }
        >
          {vacQ.isLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (vacQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState title={tHome('noVacancies')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(vacQ.data?.items ?? []).map((v) => (
                <VacancyRow key={v.id} vacancy={v} />
              ))}
            </ul>
          )}
        </SectionPanel>

        <SectionPanel
          title={tHome('upcomingEvents')}
          subtitle={tHome('upcomingEventsHint')}
          actions={
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/career/events">
                {tHome('openAll')}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          }
        >
          {eventsQ.isLoading ? (
            <Skeleton className="h-32 w-full rounded-lg" />
          ) : (eventsQ.data?.items.length ?? 0) === 0 ? (
            <EmptyState title={tHome('noEvents')} className="border-0 p-6" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(eventsQ.data?.items ?? []).map((e) => (
                <CareerEventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </SectionPanel>
      </div>

      {/* Резюме: единственное состояние, которое студент не видит нигде на обзоре, —
          включена ли публичная ссылка. Оно же чаще всего и нужно перед откликом. */}
      {resume && (
        <SectionPanel
          title={tHome('resumeTitle')}
          subtitle={resume.title}
          actions={
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link href="/career/resume">
                {tHome('openAll')}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </Button>
          }
        >
          <div className="flex items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Badge variant={resume.published ? 'success' : 'secondary'}>
              {resume.published ? tHome('resumePublic') : tHome('resumePrivate')}
            </Badge>
          </div>
        </SectionPanel>
      )}

      {/* Последние отклики не дублируем списком: их статусы уже сведены в плитках выше,
          а сам список — отдельный раздел со своей таблицей. */}
      {appsQ.data && appsQ.data.items.length === 0 && (
        <EmptyState
          icon={<Briefcase className="size-6" aria-hidden />}
          title={tApp('empty')}
          description={tApp('emptyHint')}
          action={
            <Button asChild>
              <Link href="/career/vacancies">{tHome('freshVacancies')}</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}

function VacancyRow({ vacancy: v }: { vacancy: Vacancy }) {
  const t = useTranslations('Vacancies')
  return (
    <li>
      {/* Ведём в раздел, а не в карточку: отдельной страницы вакансии нет — список
          открывает её у себя, и ссылка с `?open=` просто потерялась бы. */}
      <Link
        href="/career/vacancies"
        className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Briefcase className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{v.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {v.company.name}
            {v.city ? ` · ${v.city}` : ''}
          </span>
        </span>
        {v.match && (
          <Badge variant="secondary" className="shrink-0">
            {v.match.score}% {t('match')}
          </Badge>
        )}
      </Link>
    </li>
  )
}

function CareerEventRow({ event: e }: { event: CareerEvent }) {
  const t = useTranslations('CareerEvents')
  const format = useFormatter()
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border p-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <CalendarClock className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{e.title}</span>
        <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
          {format.dateTime(new Date(e.startsAt), {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {e.isOnline ? (
            <span className="inline-flex items-center gap-1 text-info">
              <Video className="size-3" aria-hidden />
              {t('online')}
            </span>
          ) : (
            e.location && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{e.location}</span>
              </span>
            )
          )}
        </span>
      </span>
      {e.registered && (
        <Badge variant="success" className="shrink-0">
          {t('registered')}
        </Badge>
      )}
    </li>
  )
}
