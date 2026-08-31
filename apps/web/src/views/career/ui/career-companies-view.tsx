'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Building2, ExternalLink } from 'lucide-react'
import type { CompanyAccessStatus, DecideCompanyAccessInput } from '@studenthub/shared-schemas'
import {
  companyKeys,
  decideCompanyAccess,
  fetchUniversityCompanyAccess,
  type UniversityCompanyAccess,
} from '../../../entities/company'
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

/** Фильтр очереди. 'ALL' — не статус, а «показать все», поэтому отдельным типом. */
type StatusFilter = CompanyAccessStatus | 'ALL'

/**
 * Карьерный центр вуза: очередь заявок компаний.
 *
 * Здесь принимается решение, кто увидит студентов этого вуза, поэтому отказ и отзыв
 * требуют причины — она уходит компании. Одобрение причины не требует.
 */
export function CareerCompaniesView() {
  const t = useTranslations('CareerAdmin')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('REQUESTED')
  const [page, setPage] = useState(1)
  const limit = 20

  const query = useQuery({
    queryKey: companyKeys.universityAccess({
      page,
      limit,
      ...(status === 'ALL' ? {} : { status }),
    }),
    queryFn: () =>
      fetchUniversityCompanyAccess({ page, limit, ...(status === 'ALL' ? {} : { status }) }),
  })

  const decide = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DecideCompanyAccessInput }) =>
      decideCompanyAccess(id, input),
    onSuccess: async () => {
      toast.success(t('decisionSaved'))
      await queryClient.invalidateQueries({ queryKey: companyKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []
  const total = query.data?.total ?? 0

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('companiesTitle')}
        subtitle={t('companiesSubtitle')}
        tabs={
          <SegmentedTabs<StatusFilter>
            aria-label={t('companiesTitle')}
            items={[
              { value: 'REQUESTED', label: t('tabRequested') },
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
          {['58%', '44%', '66%'].map((w) => (
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
          icon={<Building2 className="size-6" aria-hidden />}
          title={t('noCompanies')}
          description={t('noCompaniesHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <CompanyRow
                key={row.id}
                row={row}
                busy={decide.isPending}
                onDecide={(input) => decide.mutate({ id: row.id, input })}
              />
            ))}
          </ul>
          <TablePagination page={page} limit={limit} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

const STATUS_TONE: Record<
  CompanyAccessStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  REQUESTED: 'outline',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
  REVOKED: 'destructive',
}

function CompanyRow({
  row,
  busy,
  onDecide,
}: {
  row: UniversityCompanyAccess
  busy: boolean
  onDecide: (input: DecideCompanyAccessInput) => void
}) {
  const t = useTranslations('CareerAdmin')
  // Форма отказа/отзыва раскрывается по кнопке: причина обязательна, и без неё запрос
  // всё равно не пройдёт валидацию на сервере.
  const [rejecting, setRejecting] = useState<null | 'REJECTED' | 'REVOKED'>(null)
  const [reason, setReason] = useState('')

  const label: Record<CompanyAccessStatus, string> = {
    REQUESTED: t('statusRequested'),
    APPROVED: t('statusApproved'),
    REJECTED: t('statusRejected'),
    REVOKED: t('statusRevoked'),
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{row.company.name}</p>
            <Badge variant={STATUS_TONE[row.status]}>{label[row.status]}</Badge>
          </div>
          {row.company.city && <p className="text-sm text-muted-foreground">{row.company.city}</p>}
          {row.company.website && (
            <a
              href={row.company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              {row.company.website}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {row.message && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{row.message}</p>
          )}
          {row.reason && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('decisionReason')}: {row.reason}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {row.status === 'REQUESTED' && (
            <>
              <Button size="sm" disabled={busy} onClick={() => onDecide({ status: 'APPROVED' })}>
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setRejecting('REJECTED')}
              >
                {t('reject')}
              </Button>
            </>
          )}
          {row.status === 'APPROVED' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setRejecting('REVOKED')}
            >
              {t('revoke')}
            </Button>
          )}
        </div>
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
                onDecide({ status: rejecting, reason: reason.trim() })
                setRejecting(null)
                setReason('')
              }}
            >
              {rejecting === 'REVOKED' ? t('revoke') : t('reject')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
