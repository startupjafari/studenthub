'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Building2, CheckCircle2, Clock, GraduationCap, ShieldAlert } from 'lucide-react'
import { isAccessActive } from '@studenthub/shared-schemas'
import { companyKeys, fetchMyCompany, fetchMyCompanyAccess } from '../../../entities/company'
import { Button, PageHeader, PageLoader } from '../../../shared/ui'
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

  if (company.isLoading) return <PageLoader label={tCommon('loading')} />

  const rows = access.data ?? []
  const approved = rows.filter((a) => isAccessActive(a))
  const pending = rows.filter((a) => a.status === 'REQUESTED')
  const blocked = company.data?.status === 'BLOCKED'
  const unverified = company.data?.status === 'PENDING_EMAIL'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={company.data?.name ?? t('title')} subtitle={t('subtitle')} />

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
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          icon={<CheckCircle2 className="size-5 text-primary" aria-hidden />}
          value={approved.length}
          label={t('approvedUniversities')}
        />
        <Stat
          icon={<Clock className="size-5 text-muted-foreground" aria-hidden />}
          value={pending.length}
          label={t('pendingRequests')}
        />
      </div>

      {approved.length === 0 && !unverified && !blocked && (
        <Notice
          tone="muted"
          icon={<GraduationCap className="size-5" aria-hidden />}
          title={t('noAccessTitle')}
          text={t('noAccessText')}
          action={
            <Button asChild size="sm">
              <Link href="/employer/access">{t('requestAccess')}</Link>
            </Button>
          }
        />
      )}

      <Notice
        tone="muted"
        icon={<Building2 className="size-5" aria-hidden />}
        title={t('companyTitle')}
        text={t('companyText')}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/employer/company">{t('editCompany')}</Link>
          </Button>
        }
      />
    </div>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </span>
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
