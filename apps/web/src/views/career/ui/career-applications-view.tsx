'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ExternalLink, Send } from 'lucide-react'
import { isApplicationFinal } from '@studenthub/shared-schemas'
import {
  applicationKeys,
  fetchApplicationHistory,
  fetchMyApplications,
  withdrawApplication,
  type StudentApplication,
} from '../../../entities/career-application'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  TablePagination,
  useConfirm,
} from '../../../shared/ui'
import { toApiError, useApplicationStatusLabels } from '../../../shared/lib'

/**
 * Отклики студента.
 *
 * Статус здесь — не украшение: это единственное, что человек узнаёт о судьбе своей
 * заявки, поэтому он крупный и на первом месте в строке.
 */
export function CareerApplicationsView() {
  const t = useTranslations('CareerApplications')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [page, setPage] = useState(1)
  const limit = 20

  const query = useQuery({
    queryKey: applicationKeys.mine({ page, limit }),
    queryFn: () => fetchMyApplications({ page, limit }),
  })

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawApplication(id),
    onSuccess: async () => {
      toast.success(t('withdrawn'))
      await queryClient.invalidateQueries({ queryKey: applicationKeys.all })
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['62%', '48%'].map((w) => (
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
          icon={<Send className="size-6" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((application) => (
              <ApplicationRow
                key={application.id}
                application={application}
                busy={withdraw.isPending}
                // Отзыв необратим (WITHDRAWN — конечный статус): спрашиваем, а не отзываем
                // с одного случайного нажатия.
                onWithdraw={() =>
                  void confirm({
                    title: t('withdrawConfirm'),
                    description: t('withdrawConfirmText'),
                    confirmLabel: t('withdraw'),
                    destructive: true,
                  }).then((ok) => {
                    if (ok) withdraw.mutate(application.id)
                  })
                }
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

function ApplicationRow({
  application,
  busy,
  onWithdraw,
}: {
  application: StudentApplication
  busy: boolean
  onWithdraw: () => void
}) {
  const t = useTranslations('CareerApplications')
  const { label, tone } = useApplicationStatusLabels()
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tone[application.status]}>{label[application.status]}</Badge>
          <p className="font-semibold">{application.vacancy.title}</p>
        </div>
        <p className="text-sm text-muted-foreground">{application.vacancy.company.name}</p>
        {/* Связь с работодателем вне платформы. Остаётся доступной, даже когда вуз отозвал
            допуск компании и вакансия ушла с витрины: отклик уже подан, и обрывать контакт
            на середине переписки нельзя (решение по Ф18). */}
        {application.vacancy.company.website && (
          <a
            href={application.vacancy.company.website}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            <span className="truncate">{application.vacancy.company.website}</span>
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          {historyOpen ? t('historyHide') : t('history')}
        </Button>
        {!isApplicationFinal(application.status) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
            {t('withdraw')}
          </Button>
        )}
      </div>

      {historyOpen && <ApplicationHistory applicationId={application.id} />}
    </li>
  )
}

/**
 * Хронология отклика: когда компания посмотрела, позвала, отказала. Причина отказа —
 * то единственное, что студенту есть узнать из отказа, поэтому показываем её текстом.
 */
function ApplicationHistory({ applicationId }: { applicationId: string }) {
  const t = useTranslations('CareerApplications')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const { label } = useApplicationStatusLabels()
  const query = useQuery({
    queryKey: applicationKeys.history(applicationId),
    queryFn: () => fetchApplicationHistory(applicationId),
  })

  if (query.isLoading) {
    return <Skeleton className="h-12 w-full basis-full rounded-lg" />
  }
  if (query.isError) {
    return (
      <p className="basis-full text-sm text-destructive">{tErr(toApiError(query.error).code)}</p>
    )
  }

  const events = query.data ?? []
  if (events.length === 0) {
    return <p className="basis-full text-sm text-muted-foreground">{t('historyEmpty')}</p>
  }

  return (
    <ol className="flex basis-full flex-col gap-2 border-t border-border pt-3">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {new Date(event.createdAt).toLocaleString(locale, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="font-medium">{label[event.toStatus]}</span>
          </div>
          {event.comment && (
            <p className="whitespace-pre-line text-muted-foreground">{event.comment}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
