'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { careerEventKeys, fetchUniversityCareerAnalytics } from '../../../entities/career-event'
import { PageHeader, PageLoader, Progress } from '../../../shared/ui'

/**
 * Метрики карьерного модуля вуза.
 *
 * Только агрегаты: вуз имеет право видеть, как идёт трудоустройство, но не получать
 * через «аналитику» список студентов, скрывших профиль. Прочерк вместо нуля там, где
 * знаменатель пуст, — «ещё нечего считать» и «0%» это разные вещи.
 */
export function CareerAnalyticsView() {
  const t = useTranslations('CareerAnalytics')
  const tCommon = useTranslations('Common')
  const query = useQuery({
    queryKey: careerEventKeys.universityAnalytics(),
    queryFn: fetchUniversityCareerAnalytics,
  })

  if (query.isLoading || !query.data) return <PageLoader label={tCommon('loading')} />
  const d = query.data
  const sum = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + b, 0)
  const visibleShare =
    d.profiles.total > 0 ? Math.round((d.profiles.visible / d.profiles.total) * 100) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={d.companies.APPROVED ?? 0} label={t('companiesApproved')} />
        <Stat value={d.vacancies.APPROVED ?? 0} label={t('vacanciesApproved')} />
        <Stat value={sum(d.funnel)} label={t('applications')} />
        <Stat value={d.funnel.HIRED ?? 0} label={t('hired')} />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t('profilesTitle')}</p>
        <p className="text-sm text-muted-foreground">
          {t('profilesText', { visible: d.profiles.visible, total: d.profiles.total })}
        </p>
        <Progress value={visibleShare ?? 0} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">{t('ratesTitle')}</p>
        <ul className="flex flex-col gap-2">
          <RateRow label={t('rateInterview')} value={d.rates.interview} />
          <RateRow label={t('rateOffer')} value={d.rates.offer} />
          <RateRow label={t('rateHired')} value={d.rates.hired} />
        </ul>
        <p className="text-xs text-muted-foreground">{t('ratesHint')}</p>
      </section>
    </div>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function RateRow({ label, value }: { label: string; value: number | null }) {
  const t = useTranslations('CareerAnalytics')
  return (
    <li className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-sm">{label}</span>
      <span className="min-w-0 flex-1">
        <Progress value={value ?? 0} />
      </span>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums">
        {/* Прочерк, а не 0%: считать пока не от чего. */}
        {value === null ? t('noData') : `${value}%`}
      </span>
    </li>
  )
}
