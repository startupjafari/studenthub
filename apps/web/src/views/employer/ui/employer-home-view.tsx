'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Eye,
  GraduationCap,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react'
import { isAccessActive } from '@studenthub/shared-schemas'
import { careerEventKeys, fetchCompanyCareerAnalytics } from '../../../entities/career-event'
import {
  companyKeys,
  fetchMyCompany,
  fetchMyCompanyAccess,
  isCompanyOwner,
} from '../../../entities/company'
import { fetchMe, userKeys } from '../../../entities/user'
import { ResendVerificationButton } from '../../../features/resend-company-verification'
import { Button, MetricTile, PageHeader, PageLoader, SeasonGreeting } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

/**
 * Обзор работодателя. Главное на первом экране — объяснить, почему компания пока никого
 * не видит: без подтверждённой почты и без одобренного вузом допуска доступа к студентам
 * нет вообще. Молчаливый пустой экран здесь читался бы как поломка.
 */
export function EmployerHomeView() {
  const t = useTranslations('Employer')
  const tCommon = useTranslations('Common')

  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })
  const access = useQuery({ queryKey: companyKeys.myAccess(), queryFn: fetchMyCompanyAccess })
  // Почта нужна только для «отправить письмо ещё раз», пока адрес не подтверждён.
  const unverified = company.data?.status === 'PENDING_EMAIL'
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe, enabled: unverified })
  // Метрики подбора (D-F30): ручка была, экрана не было. Пока почта не подтверждена или
  // компания заблокирована, считать нечего — запрос не шлём.
  const active = company.data?.status === 'ACTIVE'
  const metrics = useQuery({
    queryKey: careerEventKeys.companyAnalytics(),
    queryFn: fetchCompanyCareerAnalytics,
    enabled: active,
  })

  if (company.isLoading) return <PageLoader label={tCommon('loading')} />
  const owner = isCompanyOwner(company.data)

  const rows = access.data ?? []
  const approved = rows.filter((a) => isAccessActive(a))
  const pending = rows.filter((a) => a.status === 'REQUESTED')
  const blocked = company.data?.status === 'BLOCKED'

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={company.data?.name ?? t('title')} subtitle={t('subtitle')} />
      <SeasonGreeting />

      {blocked && (
        <Notice
          tone="danger"
          icon={<ShieldAlert className="size-5" aria-hidden />}
          title={t('blockedTitle')}
          text={company.data?.blockedReason ?? t('blockedText')}
        />
      )}

      {unverified && (
        <Notice
          tone="warning"
          icon={<Clock className="size-5" aria-hidden />}
          title={t('unverifiedTitle')}
          text={t('unverifiedText')}
          action={me.data?.email ? <ResendVerificationButton email={me.data.email} /> : undefined}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile
          index={0}
          icon={CheckCircle2}
          tone="text-success"
          value={approved.length}
          label={t('approvedUniversities')}
          loading={access.isLoading}
        />
        <MetricTile
          index={1}
          icon={Clock}
          tone="text-warning"
          value={pending.length}
          label={t('pendingRequests')}
          loading={access.isLoading}
        />
      </div>

      {active && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            index={2}
            icon={Briefcase}
            value={metrics.data?.vacancies.PUBLISHED ?? 0}
            label={t('metricsPublished')}
            loading={metrics.isLoading}
            href="/employer/vacancies"
          />
          <MetricTile
            index={3}
            icon={Eye}
            value={metrics.data?.views ?? 0}
            label={t('metricsViews')}
            loading={metrics.isLoading}
          />
          <MetricTile
            index={4}
            icon={Users}
            value={
              metrics.data ? Object.values(metrics.data.funnel).reduce((sum, n) => sum + n, 0) : 0
            }
            label={t('metricsApplications')}
            loading={metrics.isLoading}
            href="/employer/candidates"
          />
          <MetricTile
            index={5}
            icon={UserCheck}
            tone="text-success"
            value={metrics.data?.funnel.HIRED ?? 0}
            label={t('metricsHired')}
            loading={metrics.isLoading}
          />
        </div>
      )}

      {approved.length === 0 && !unverified && !blocked && (
        <Notice
          tone="muted"
          icon={<GraduationCap className="size-5" aria-hidden />}
          title={t('noAccessTitle')}
          text={t('noAccessText')}
          // Заявку в вуз подаёт владелец; рекрутёру кнопка вела бы в 403.
          action={
            owner ? (
              <Button asChild size="sm">
                <Link href="/employer/access">{t('requestAccess')}</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      <Notice
        tone="muted"
        icon={<Building2 className="size-5" aria-hidden />}
        title={t('companyTitle')}
        text={t('companyText')}
        action={
          owner ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/employer/company">{t('editCompany')}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  )
}

const TONE = {
  danger: 'border-destructive/40 bg-destructive/5 text-destructive',
  warning: 'border-border bg-muted/40 text-foreground',
  muted: 'border-border bg-card text-foreground',
} as const

function Notice({
  tone,
  icon,
  title,
  text,
  action,
}: {
  tone: keyof typeof TONE
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', TONE[tone])}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {action}
    </div>
  )
}
