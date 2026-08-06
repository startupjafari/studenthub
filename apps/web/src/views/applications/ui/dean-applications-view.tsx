'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Inbox } from 'lucide-react'
import {
  APP_TYPES,
  APPLICATION_STATUSES,
  applicationKeys,
  fetchApplication,
  fetchApplications,
  type ApplicationStatusValue,
  type AppTypeValue,
} from '../../../entities/application'
import { TransitionStatusForm } from '../../../features/transition-application-status'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'
import { AttachmentList, StatusBadge, StatusTimeline } from './application-parts'

export function DeanApplicationsView() {
  const t = useTranslations('Applications')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [status, setStatus] = useState<ApplicationStatusValue | 'all'>('all')
  const [type, setType] = useState<AppTypeValue | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filters = {
    ...(status !== 'all' ? { status } : {}),
    ...(type !== 'all' ? { type } : {}),
  }
  const list = useQuery({
    queryKey: applicationKeys.list(filters),
    queryFn: () => fetchApplications(filters),
  })
  const detail = useQuery({
    queryKey: applicationKeys.detail(selectedId ?? ''),
    queryFn: () => fetchApplication(selectedId as string),
    enabled: !!selectedId,
  })

  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('queueTitle')}</h1>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as ApplicationStatusValue | 'all')}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('filterStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatuses')}</SelectItem>
              {APPLICATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`status${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={type} onValueChange={(v) => setType(v as AppTypeValue | 'all')}>
            <SelectTrigger>
              <SelectValue placeholder={t('filterType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allTypes')}</SelectItem>
              {APP_TYPES.map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {t(`type${tp}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Очередь */}
        <div className="flex flex-col gap-2">
          {list.isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : list.isError ? (
            <EmptyState title={tErr('INTERNAL_ERROR')} />
          ) : (list.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden />}
              title={t('queueEmpty')}
              description={t('queueEmptyHint')}
            />
          ) : (
            list.data!.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50',
                  selectedId === a.id && 'border-primary/50 bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{a.subject}</span>
                  <StatusBadge status={a.status} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(`type${a.type}`)} · {fmt(a.createdAt)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Детали + смена статуса */}
        <div>
          {!selectedId ? (
            <Card className="flex min-h-[200px] items-center justify-center">
              <p className="text-sm text-muted-foreground">{t('selectHint')}</p>
            </Card>
          ) : detail.isLoading || !detail.data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate">{detail.data.subject}</span>
                  <StatusBadge status={detail.data.status} />
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-xs text-muted-foreground">
                  {t('studentLabel')}: {detail.data.student.lastName}{' '}
                  {detail.data.student.firstName}
                </p>
                <p className="text-sm whitespace-pre-wrap">{detail.data.body}</p>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{t('attachments')}</h3>
                  <AttachmentList
                    applicationId={detail.data.id}
                    attachments={detail.data.attachments}
                  />
                </section>

                <section className="rounded-xl border border-border p-3">
                  <TransitionStatusForm
                    applicationId={detail.data.id}
                    currentStatus={detail.data.status}
                  />
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{t('timeline')}</h3>
                  <StatusTimeline history={detail.data.history} />
                </section>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
