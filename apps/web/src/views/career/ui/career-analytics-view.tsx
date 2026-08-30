'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Briefcase, Building2, FileText, UserCheck } from 'lucide-react'
import { careerEventKeys, fetchUniversityCareerAnalytics } from '../../../entities/career-event'
import { MetricTile, PageHeader, PageLoader, Progress, SectionPanel } from '../../../shared/ui'

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
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          icon={Building2}
          label={t('companiesApproved')}
          value={d.companies.APPROVED ?? 0}
        />
        <MetricTile
          icon={Briefcase}
          tone="text-info"
          label={t('vacanciesApproved')}
          value={d.vacancies.APPROVED ?? 0}
        />
        <MetricTile
          icon={FileText}
          tone="text-warning"
          label={t('applications')}
          value={sum(d.funnel)}
        />
        <MetricTile
          icon={UserCheck}
          tone="text-success"
          label={t('hired')}
          value={d.funnel.HIRED ?? 0}
        />
      </div>

      <SectionPanel
        title={t('profilesTitle')}
        subtitle={t('profilesText', { visible: d.profiles.visible, total: d.profiles.total })}
      >
        <Progress value={visibleShare ?? 0} />
      </SectionPanel>

      <SectionPanel title={t('ratesTitle')} subtitle={t('ratesHint')}>
        <ul className="flex flex-col gap-2">
          <RateRow label={t('rateInterview')} value={d.rates.interview} />
          <RateRow label={t('rateOffer')} value={d.rates.offer} />
          <RateRow label={t('rateHired')} value={d.rates.hired} />
        </ul>
      </SectionPanel>
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
