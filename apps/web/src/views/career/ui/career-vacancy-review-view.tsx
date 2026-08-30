'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Briefcase } from 'lucide-react'
import type { VacancyReviewStatus } from '@studenthub/shared-schemas'
import {
  decideVacancyReview,
  fetchVacancyReviewQueue,
  vacancyKeys,
  type VacancyReviewRow,
} from '../../../entities/vacancy'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SegmentedTabs,
  Skeleton,
  TablePagination,
  Textarea,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

type Filter = VacancyReviewStatus | 'ALL'

/**
 * Модерация вакансий вузом.
 *
 * Решение действует только на студентов ЭТОГО вуза: та же вакансия рассматривается
 * каждым допустившим компанию университетом отдельно.
 */
export function CareerVacancyReviewView() {
  const t = useTranslations('CareerAdmin')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Filter>('PENDING')
  const [page, setPage] = useState(1)
  const limit = 20

  const params = { page, limit, ...(status === 'ALL' ? {} : { status }) }
  const query = useQuery({
    queryKey: vacancyKeys.reviewQueue(params),
    queryFn: () => fetchVacancyReviewQueue(params),
  })

  const decide = useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string
      status: 'APPROVED' | 'REJECTED'
      reason?: string
    }) => decideVacancyReview(id, input),
    onSuccess: async () => {
      toast.success(t('decisionSaved'))
      await queryClient.invalidateQueries({ queryKey: vacancyKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('vacanciesTitle')}
        subtitle={t('vacanciesSubtitle')}
        tabs={
          <SegmentedTabs<Filter>
            aria-label={t('vacanciesTitle')}
            items={[
              { value: 'PENDING', label: t('tabRequested') },
              { value: 'APPROVED', label: t('tabApproved') },
              { value: 'ALL', label: t('tabAll') },
            ]}
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
          />
        }
      />

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['64%', '48%'].map((w) => (
            <li key={w} className="rounded-xl border border-border p-4">
              <Skeleton className="h-4 rounded-md" style={{ width: w }} />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr('INTERNAL_ERROR')} description={tErr('retryHint')} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="size-6" aria-hidden />}
          title={t('noVacancies')}
          description={t('noVacanciesHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <ReviewRow
                key={row.id}
                row={row}
                busy={decide.isPending}
                onDecide={(input) => decide.mutate({ id: row.id, ...input })}
              />
            ))}
          </ul>
          <TablePagination
            page={page}
            limit={limit}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}

function ReviewRow({
  row,
  busy,
  onDecide,
}: {
  row: VacancyReviewRow
  busy: boolean
  onDecide: (input: { status: 'APPROVED' | 'REJECTED'; reason?: string }) => void
}) {
  const t = useTranslations('CareerAdmin')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const label: Record<VacancyReviewStatus, string> = {
    PENDING: t('statusPending'),
    APPROVED: t('statusApproved'),
    REJECTED: t('statusRejected'),
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{row.vacancy.title}</p>
            <Badge variant={row.status === 'APPROVED' ? 'secondary' : 'outline'}>
              {label[row.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{row.vacancy.company.name}</p>
          <p className="max-w-prose text-sm text-muted-foreground line-clamp-3">
            {row.vacancy.description}
          </p>
          {row.reason && (
            <p className="text-sm text-muted-foreground">
              {t('decisionReason')}: {row.reason}
            </p>
          )}
        </div>

        {row.status === 'PENDING' && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={busy} onClick={() => onDecide({ status: 'APPROVED' })}>
              {t('approve')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              {t('reject')}
            </Button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t('reasonPlaceholder')}
            aria-label={t('decisionReason')}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || reason.trim().length === 0}
              onClick={() => {
                onDecide({ status: 'REJECTED', reason: reason.trim() })
                setRejecting(false)
                setReason('')
              }}
            >
              {t('reject')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
