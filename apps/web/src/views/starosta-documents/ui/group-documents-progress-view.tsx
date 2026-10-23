'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFormatter, useTranslations } from 'next-intl'
import { ChevronDown, ClipboardList, Lock } from 'lucide-react'
import type { GroupProgressStatus, GroupRequestProgress } from '@studenthub/shared-schemas'
import { documentRequestKeys, fetchGroupProgress } from '../../../entities/document-request'
import { Badge, Button, Card, EmptyState, PageHeader, Progress, Skeleton } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

// Прогресс группы по запросам документов (15.2/15.6): староста видит, кто из группы уже
// сдал комплект, — чтобы напомнить, а не чтобы смотреть документы. Документов здесь нет
// вовсе: ни типов, ни номеров, ни файлов. Поимённо — только учебные запросы; по запросам с
// личными документами — только счётчики (так отвечает и сервер).

const STATUS_TONE: Record<GroupProgressStatus, 'secondary' | 'info' | 'success' | 'destructive'> = {
  NOT_STARTED: 'secondary',
  IN_PROGRESS: 'secondary',
  SUBMITTED: 'info',
  NEEDS_FIX: 'destructive',
  ACCEPTED: 'success',
}

export function GroupDocumentsProgressView() {
  const t = useTranslations('GroupDocuments')
  const tCommon = useTranslations('Common')
  const q = useQuery({ queryKey: documentRequestKeys.groupProgress(), queryFn: fetchGroupProgress })
  const requests = q.data ?? []

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {q.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={<ClipboardList className="size-6" aria-hidden />}
          title={t('loadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void q.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map((r) => (
            <RequestProgressCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function RequestProgressCard({ request: r }: { request: GroupRequestProgress }) {
  const t = useTranslations('GroupDocuments')
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const { counts } = r
  const done = counts.total > 0 ? Math.round((counts.accepted / counts.total) * 100) : 0
  const listId = `group-progress-${r.id}`

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{r.title}</span>
          <span className="text-xs text-muted-foreground">
            {r.dueAt
              ? t('due', {
                  date: format.dateTime(new Date(r.dueAt), { day: 'numeric', month: 'long' }),
                })
              : t('noDue')}
            {!r.acceptsSubmissions && ` · ${t('closedForSubmissions')}`}
          </span>
        </div>
        <Badge variant={r.kind === 'ACADEMIC' ? 'info' : 'secondary'}>
          {r.kind === 'ACADEMIC' ? t('kindAcademic') : t('kindPersonal')}
        </Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <Progress
          value={done}
          indicatorClassName="bg-success"
          aria-label={t('acceptedShare', { accepted: counts.accepted, total: counts.total })}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>{t('countAccepted', { n: counts.accepted })}</span>
          <span>{t('countSubmitted', { n: counts.submitted })}</span>
          {counts.needsFix !== null && <span>{t('countNeedsFix', { n: counts.needsFix })}</span>}
          <span>{t('countNotSubmitted', { n: counts.notSubmitted })}</span>
          <span>{t('countTotal', { n: counts.total })}</span>
        </div>
      </div>

      {r.members ? (
        <>
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronDown
                className={cn('size-4 transition-transform', open && 'rotate-180')}
                aria-hidden
              />
              {open ? t('hideMembers') : t('showMembers')}
            </Button>
          </div>
          {open && (
            <ul id={listId} className="flex flex-col divide-y divide-border">
              {r.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <Badge variant={STATUS_TONE[m.status]}>{t(`status_${m.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          {t('personalHint')}
        </p>
      )}
    </Card>
  )
}
