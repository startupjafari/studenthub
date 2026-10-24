'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Briefcase, Eye, Pencil, Plus } from 'lucide-react'
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
import { VacancyFormModal } from './vacancy-form-modal'

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
  // Открытая форма: `null` — новая вакансия, строка — правка этой вакансии.
  const [form, setForm] = useState<{ vacancy: EmployerVacancy | null } | null>(null)

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
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button onClick={() => setForm({ vacancy: null })}>
            <Plus className="size-4" aria-hidden /> {t('create')}
          </Button>
        }
      />

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['58%', '44%'].map((w) => (
            <li
              key={w}
              data-skeleton-fill=""
              className="flex flex-1 items-center rounded-xl border border-border p-4"
            >
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
                onEdit={() => setForm({ vacancy })}
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

      {form && <VacancyFormModal vacancy={form.vacancy} onClose={() => setForm(null)} />}
    </div>
  )
}

function VacancyRow({
  vacancy,
  busy,
  onAct,
  onEdit,
}: {
  vacancy: EmployerVacancy
  busy: boolean
  onAct: (action: 'publish' | 'pause' | 'close') => void
  onEdit: () => void
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
          {/* Закрытая вакансия — конечное состояние: ни правки, ни публикации. */}
          {vacancy.status !== 'CLOSED' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden /> {t('edit')}
            </Button>
          )}
          {(vacancy.status === 'DRAFT' || vacancy.status === 'PAUSED') && (
            <Button size="sm" disabled={busy} onClick={() => onAct('publish')}>
              {t('publish')}
            </Button>
          )}
          {/* Повторная публикация опубликованной: вуз, допустивший компанию позже или
              вернувший допуск, получает вакансию на модерацию; одобрения других вузов
              сервер не трогает. */}
          {vacancy.status === 'PUBLISHED' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAct('publish')}
              title={t('republishHint')}
            >
              {t('republish')}
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
          {/* Причина отказа или снятия: без неё компания видит только, что вакансия
              исчезла, и не знает, что исправить. */}
          {vacancy.reviews.some((review) => review.status === 'REJECTED' && review.reason) && (
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {vacancy.reviews.map((review) =>
                review.status === 'REJECTED' && review.reason ? (
                  <li key={review.university.id}>
                    {t('rejectReason', {
                      university: review.university.name,
                      reason: review.reason,
                    })}
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
