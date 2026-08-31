'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Briefcase, Eye } from 'lucide-react'
import type { VacancyReviewStatus, VacancyStatus } from '@studenthub/shared-schemas'
import {
  closeVacancy,
  fetchMyVacancies,
  pauseVacancy,
  publishVacancy,
  vacancyKeys,
  type EmployerVacancy,
} from '../../../entities/vacancy'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  TablePagination,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/**
 * Вакансии компании.
 *
 * Главное, что здесь должно быть видно, — что публикация не равна показу: у каждого вуза
 * своё решение, и вакансия видна студентам только тех, кто её одобрил. Поэтому решения
 * перечислены по вузам, а не сведены в один статус.
 */
export function EmployerVacanciesView() {
  const t = useTranslations('EmployerVacancies')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const limit = 20

  const query = useQuery({
    queryKey: vacancyKeys.mine(page),
    queryFn: () => fetchMyVacancies(page),
  })

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'pause' | 'close' }) => {
      if (action === 'publish') return publishVacancy(id)
      if (action === 'pause') return pauseVacancy(id)
      return closeVacancy(id)
    },
    onSuccess: async () => {
      toast.success(t('saved'))
      await queryClient.invalidateQueries({ queryKey: vacancyKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['58%', '44%'].map((w) => (
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
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((vacancy) => (
              <VacancyRow
                key={vacancy.id}
                vacancy={vacancy}
                busy={act.isPending}
                onAct={(action) => act.mutate({ id: vacancy.id, action })}
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

function VacancyRow({
  vacancy,
  busy,
  onAct,
}: {
  vacancy: EmployerVacancy
  busy: boolean
  onAct: (action: 'publish' | 'pause' | 'close') => void
}) {
  const t = useTranslations('EmployerVacancies')

  const statusLabel: Record<VacancyStatus, string> = {
    DRAFT: t('statusDraft'),
    PUBLISHED: t('statusPublished'),
    PAUSED: t('statusPaused'),
    CLOSED: t('statusClosed'),
  }
  const reviewLabel: Record<VacancyReviewStatus, string> = {
    PENDING: t('reviewPending'),
    APPROVED: t('reviewApproved'),
    REJECTED: t('reviewRejected'),
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{vacancy.title}</p>
            <Badge variant={vacancy.status === 'PUBLISHED' ? 'secondary' : 'outline'}>
              {statusLabel[vacancy.status]}
            </Badge>
          </div>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Eye className="size-3.5" aria-hidden />
            {vacancy.views}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {(vacancy.status === 'DRAFT' || vacancy.status === 'PAUSED') && (
            <Button size="sm" disabled={busy} onClick={() => onAct('publish')}>
              {t('publish')}
            </Button>
          )}
          {vacancy.status === 'PUBLISHED' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAct('pause')}>
              {t('pause')}
            </Button>
          )}
          {vacancy.status !== 'CLOSED' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAct('close')}>
              {t('close')}
            </Button>
          )}
        </div>
      </div>

      {/* Решения вузов: публикация не равна показу — это надо видеть явно. */}
      {vacancy.reviews.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{t('byUniversity')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {vacancy.reviews.map((review) => (
              <li key={review.university.id}>
                <Badge variant={review.status === 'APPROVED' ? 'secondary' : 'outline'}>
                  {review.university.name}: {reviewLabel[review.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
