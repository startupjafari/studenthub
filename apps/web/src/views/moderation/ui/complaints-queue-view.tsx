'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { ShieldAlert } from 'lucide-react'
import {
  complaintKeys,
  fetchComplaintMessages,
  fetchComplaints,
  resolveComplaintRequest,
  type Complaint,
  type ComplaintStatusValue,
} from '../../../entities/complaint'
import { ProfileLink } from '../../../entities/user'
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

const STATUS_TABS: (ComplaintStatusValue | 'all')[] = ['PENDING', 'RESOLVED', 'DISMISSED', 'all']

export function ComplaintsQueueView() {
  const t = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const [status, setStatus] = useState<ComplaintStatusValue | 'all'>('PENDING')

  const complaints = useQuery({
    queryKey: complaintKeys.list(status),
    queryFn: () => fetchComplaints(status === 'all' ? undefined : status),
  })

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={t('complaintsTitle')}
        tabs={
          <div className="inline-flex w-fit flex-wrap rounded-lg border border-border bg-muted/50 p-0.5">
            {STATUS_TABS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                  status === s
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s === 'all' ? t('all') : t(`status${s}`)}
              </button>
            ))}
          </div>
        }
      />

      {complaints.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : complaints.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (complaints.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<ShieldAlert className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {complaints.data!.map((c) => (
            <ComplaintCard key={c.id} complaint={c} />
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<ComplaintStatusValue, string> = {
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REVIEWING: 'bg-primary/10 text-primary',
  RESOLVED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  DISMISSED: 'bg-muted text-muted-foreground',
}

function ComplaintCard({ complaint }: { complaint: Complaint }) {
  const t = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const [showChat, setShowChat] = useState(false)

  const isOpen = complaint.status === 'PENDING' || complaint.status === 'REVIEWING'

  const messages = useQuery({
    queryKey: complaintKeys.messages(complaint.id),
    queryFn: () => fetchComplaintMessages(complaint.id),
    enabled: showChat,
  })

  const resolveMut = useMutation({
    mutationFn: (action: 'DELETE_CONTENT' | 'BLOCK_USER' | 'DISMISS') =>
      resolveComplaintRequest(complaint.id, { action, comment: comment.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: complaintKeys.all })
      toast.success(t('resolved'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="flex items-center gap-2">
              {complaint.targetType === 'USER' ? (
                <ProfileLink userId={complaint.targetId}>
                  <Badge variant="outline" className="hover:border-primary hover:text-primary">
                    {t(`target${complaint.targetType}`)}
                  </Badge>
                </ProfileLink>
              ) : (
                <Badge variant="outline">{t(`target${complaint.targetType}`)}</Badge>
              )}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  STATUS_STYLE[complaint.status],
                )}
              >
                {t(`status${complaint.status}`)}
              </span>
            </span>
            <p className="mt-2 text-sm">{complaint.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('reporter')}:{' '}
              <ProfileLink
                userId={complaint.reporter.id}
                className="hover:text-primary hover:underline"
              >
                {complaint.reporter.lastName} {complaint.reporter.firstName}
              </ProfileLink>{' '}
              ·{' '}
              {new Date(complaint.createdAt).toLocaleString(locale, {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            {complaint.resolution && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('resolution')}: {complaint.resolution}
              </p>
            )}
          </div>
        </div>

        {/* Доступ к чату по жалобе на сообщение (пишется в аудит на бэке). */}
        {complaint.targetType === 'MESSAGE' && (
          <div className="rounded-xl border border-border p-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowChat((v) => !v)}>
              {showChat ? t('hideChat') : t('showChat')}
            </Button>
            {showChat && (
              <div className="mt-2 max-h-60 overflow-y-auto">
                {messages.isLoading ? (
                  <p className="text-xs text-muted-foreground">{t('loadingChat')}</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {(messages.data ?? []).map((m) => (
                      <li key={m.id} className="text-sm">
                        <span className="font-medium">
                          <ProfileLink userId={m.senderId} className="hover:underline">
                            {m.sender.lastName} {m.sender.firstName}
                          </ProfileLink>
                          :
                        </span>{' '}
                        <span className={cn(m.deletedAt && 'text-muted-foreground line-through')}>
                          {m.content}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {isOpen && (
          <div className="flex flex-col gap-2">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('commentPlaceholder')}
            />
            <div className="flex flex-wrap gap-2">
              {complaint.targetType !== 'USER' && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  loading={resolveMut.isPending && resolveMut.variables === 'DELETE_CONTENT'}
                  onClick={() => resolveMut.mutate('DELETE_CONTENT')}
                >
                  {t('deleteContent')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                loading={resolveMut.isPending && resolveMut.variables === 'BLOCK_USER'}
                onClick={() => resolveMut.mutate('BLOCK_USER')}
              >
                {t('blockUser')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={resolveMut.isPending && resolveMut.variables === 'DISMISS'}
                onClick={() => resolveMut.mutate('DISMISS')}
              >
                {t('dismiss')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
