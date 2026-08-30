'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import {
  CAREER_APPLICATION_TRANSITIONS,
  EMPLOYER_APPLICATION_STATUSES,
  type CareerApplicationStatus,
} from '@studenthub/shared-schemas'
import {
  applicationKeys,
  changeApplicationStatus,
  fetchPipeline,
  type PipelineApplication,
} from '../../../entities/career-application'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Skeleton,
  TablePagination,
  Textarea,
} from '../../../shared/ui'
import { toApiError, useApplicationStatusLabels } from '../../../shared/lib'

/**
 * Воронка кандидатов.
 *
 * Кнопки собираются из разрешённых переходов контракта, а не задаются вручную: иначе
 * интерфейс предлагал бы действия, которые сервер отклонит.
 */
export function EmployerCandidatesView() {
  const t = useTranslations('CareerApplications')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const limit = 20

  const query = useQuery({
    queryKey: applicationKeys.pipeline({ page, limit }),
    queryFn: () => fetchPipeline({ page, limit }),
  })

  const change = useMutation({
    mutationFn: ({
      id,
      status,
      comment,
    }: {
      id: string
      status: CareerApplicationStatus
      comment?: string
    }) =>
      changeApplicationStatus(id, {
        status: status as (typeof EMPLOYER_APPLICATION_STATUSES)[number],
        comment,
      }),
    onSuccess: async () => {
      toast.success(t('statusChanged'))
      await queryClient.invalidateQueries({ queryKey: applicationKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title={t('pipelineTitle')} subtitle={t('pipelineSubtitle')} />

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
          icon={<Users className="size-6" aria-hidden />}
          title={t('pipelineEmpty')}
          description={t('pipelineEmptyHint')}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((application) => (
              <CandidateRow
                key={application.id}
                application={application}
                busy={change.isPending}
                onChange={(status, comment) =>
                  change.mutate({ id: application.id, status, comment })
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

function CandidateRow({
  application,
  busy,
  onChange,
}: {
  application: PipelineApplication
  busy: boolean
  onChange: (status: CareerApplicationStatus, comment?: string) => void
}) {
  const t = useTranslations('CareerApplications')
  const { label, tone } = useApplicationStatusLabels()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')

  // Доступные переходы берём из контракта и оставляем только те, что вправе делать компания.
  const next = CAREER_APPLICATION_TRANSITIONS[application.status].filter((s) =>
    (EMPLOYER_APPLICATION_STATUSES as readonly string[]).includes(s),
  )

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone[application.status]}>{label[application.status]}</Badge>
            <p className="font-semibold">
              {application.student.firstName} {application.student.lastName}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{application.vacancy.title}</p>
          {application.student.headline && (
            <p className="text-sm text-muted-foreground">{application.student.headline}</p>
          )}
          {application.student.skills.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {application.student.skills.slice(0, 8).map((skill) => (
                <li key={skill}>
                  <Badge variant="outline">{skill}</Badge>
                </li>
              ))}
            </ul>
          )}
          {application.coverLetter && (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {application.coverLetter}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {next
            .filter((status) => status !== 'REJECTED')
            .map((status) => (
              <Button key={status} size="sm" disabled={busy} onClick={() => onChange(status)}>
                {label[status]}
              </Button>
            ))}
          {next.includes('REJECTED') && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
              {label.REJECTED}
            </Button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {/* Причина обязательна: отказ без объяснения — то же молчание, только формальное. */}
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={t('rejectReasonPlaceholder')}
            aria-label={t('rejectReason')}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || comment.trim().length === 0}
              onClick={() => {
                onChange('REJECTED', comment.trim())
                setRejecting(false)
                setComment('')
              }}
            >
              {label.REJECTED}
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
