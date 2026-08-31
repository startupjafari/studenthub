'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { isApplicationFinal } from '@studenthub/shared-schemas'
import {
  applicationKeys,
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
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {query.isLoading ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {['62%', '48%'].map((w) => (
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
                onWithdraw={() => withdraw.mutate(application.id)}
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

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tone[application.status]}>{label[application.status]}</Badge>
          <p className="font-semibold">{application.vacancy.title}</p>
        </div>
        <p className="text-sm text-muted-foreground">{application.vacancy.company.name}</p>
      </div>

      {!isApplicationFinal(application.status) && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>
          {t('withdraw')}
        </Button>
      )}
    </li>
  )
}
