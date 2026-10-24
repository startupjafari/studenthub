'use client'

import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { BadgeCheck, IdCard, Users } from 'lucide-react'
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
import { careerProfileKeys, fetchCandidateCard } from '../../../entities/career-profile'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
  TablePagination,
  Textarea,
  useConfirm,
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
  // Открытая карточка кандидата: id студента и имя для заголовка, пока карточка грузится.
  const [card, setCard] = useState<{ id: string; name: string } | null>(null)

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
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const rows = query.data?.items ?? []

  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <PageHeader title={t('pipelineTitle')} subtitle={t('pipelineSubtitle')} />

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
                onOpenCard={() =>
                  setCard({
                    id: application.student.id,
                    name: `${application.student.firstName} ${application.student.lastName}`,
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

      {card && (
        <CandidateCardModal studentId={card.id} name={card.name} onClose={() => setCard(null)} />
      )}
    </div>
  )
}

function CandidateRow({
  application,
  busy,
  onChange,
  onOpenCard,
}: {
  application: PipelineApplication
  busy: boolean
  onChange: (status: CareerApplicationStatus, comment?: string) => void
  onOpenCard: () => void
}) {
  const t = useTranslations('CareerApplications')
  const { label, tone } = useApplicationStatusLabels()
  const confirm = useConfirm()
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
          <Button size="sm" variant="ghost" onClick={onOpenCard}>
            <IdCard className="size-4" aria-hidden /> {t('card')}
          </Button>
          {next
            .filter((status) => status !== 'REJECTED')
            .map((status) => (
              <Button
                key={status}
                size="sm"
                disabled={busy}
                onClick={() => {
                  // Оффер и «Принят» — решения, которые студент сразу видит и которые
                  // не откатить: из них только вперёд. Их — после подтверждения.
                  if (status !== 'OFFER' && status !== 'HIRED') {
                    onChange(status)
                    return
                  }
                  void confirm({
                    title: t('statusConfirm', { status: label[status] }),
                    description: t('statusConfirmText', {
                      name: `${application.student.firstName} ${application.student.lastName}`,
                    }),
                    confirmLabel: label[status],
                  }).then((ok) => {
                    if (ok) onChange(status)
                  })
                }}
              >
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

/**
 * Карточка кандидата (D-F30): единственный путь, которым компания видит профиль студента.
 * Сервер проверяет допуск к вузу и видимость профиля, чувствительные поля отдаёт только по
 * согласию; просмотр пишется в журнал. Подтверждённые вузом сертификаты — отдельным
 * списком: в отличие от портфолио их проверил университет.
 */
function CandidateCardModal({
  studentId,
  name,
  onClose,
}: {
  studentId: string
  name: string
  onClose: () => void
}) {
  const t = useTranslations('CareerApplications')
  const tErr = useTranslations('Errors')
  const query = useQuery({
    queryKey: careerProfileKeys.candidate(studentId),
    queryFn: () => fetchCandidateCard(studentId),
    retry: false,
  })
  const c = query.data
  const notShared = <span className="text-muted-foreground">{t('cardNotShared')}</span>

  return (
    <Modal onClose={onClose} title={name} size="xl">
      {query.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : query.isError || !c ? (
        // 404 — профиль скрыт от работодателей (сервер отвечает так же, как на чужой id).
        <EmptyState
          icon={<IdCard className="size-6" aria-hidden />}
          title={
            toApiError(query.error).code === 'NOT_FOUND'
              ? t('cardHidden')
              : tErr(toApiError(query.error).code)
          }
        />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            {c.headline && <p className="font-medium">{c.headline}</p>}
            <p className="text-muted-foreground">
              {[
                c.university,
                c.specialty,
                c.course ? t('cardCourse', { n: c.course }) : null,
                c.graduationYear ? t('cardGraduation', { year: c.graduationYear }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {c.about && (
            <CardSection title={t('cardAbout')}>
              <p className="max-w-prose whitespace-pre-line">{c.about}</p>
            </CardSection>
          )}

          {c.desiredPositions.length > 0 && (
            <CardSection title={t('cardWanted')}>
              <p>{c.desiredPositions.join(', ')}</p>
            </CardSection>
          )}

          {(c.skills.length > 0 || c.languages.length > 0) && (
            <CardSection title={t('cardSkills')}>
              <ul className="flex flex-wrap gap-1.5">
                {[...c.skills, ...c.languages].map((item) => (
                  <li key={item}>
                    <Badge variant="outline">{item}</Badge>
                  </li>
                ))}
              </ul>
            </CardSection>
          )}

          {c.verifiedCertificates.length > 0 && (
            <CardSection title={t('cardCertificates')}>
              <ul className="flex flex-col gap-1.5">
                {c.verifiedCertificates.map((cert) => (
                  <li key={cert.id} className="flex items-center gap-2">
                    <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
                    <span>
                      {cert.title}
                      {cert.issuedBy && (
                        <span className="text-muted-foreground"> · {cert.issuedBy}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardSection>
          )}

          {c.portfolio.length > 0 && (
            <CardSection title={t('cardPortfolio')}>
              <ul className="flex flex-col gap-2">
                {c.portfolio.map((item) => (
                  <li key={item.id}>
                    <p className="font-medium">{item.title}</p>
                    {item.organization && (
                      <p className="text-muted-foreground">{item.organization}</p>
                    )}
                  </li>
                ))}
              </ul>
            </CardSection>
          )}

          <CardSection title={t('cardContacts')}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('cardEmail')}</dt>
              <dd className="min-w-0 truncate">{c.email ?? notShared}</dd>
              <dt className="text-muted-foreground">{t('cardPhone')}</dt>
              <dd>{c.phone ?? notShared}</dd>
              <dt className="text-muted-foreground">{t('cardGpa')}</dt>
              <dd>{c.gpa ?? notShared}</dd>
            </dl>
          </CardSection>
        </div>
      )}
    </Modal>
  )
}

function CardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}
