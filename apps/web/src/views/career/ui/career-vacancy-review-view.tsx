'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Briefcase } from 'lucide-react'
import { ADMIN_PAGE_SIZES } from '@studenthub/shared-schemas'
import type { VacancyReviewStatus } from '@studenthub/shared-schemas'
import {
  decideVacancyReview,
  fetchVacancyReviewQueue,
  vacancyKeys,
} from '../../../entities/vacancy'
import {
  Badge,
  Card,
  Button,
  EmptyState,
  PageHeader,
  PromptDialog,
  SegmentedTabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
} from '../../../shared/ui'
import {
  CareerUniversityRequired,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { toApiError } from '../../../shared/lib'

type Filter = VacancyReviewStatus | 'ALL'

/**
 * Модерация вакансий вузом.
 *
 * Решение действует только на студентов ЭТОГО вуза: та же вакансия рассматривается
 * каждым допустившим компанию университетом отдельно.
 */
// Ширины колонок: решение и название важнее описания, поэтому описание сжимается первым.
// Размеры страницы — общий для админских экранов набор из контракта.
const PAGE_SIZES = ADMIN_PAGE_SIZES

const COLS = ['26%', '20%', '30%', '10%', '14%'] as const

export function CareerVacancyReviewView() {
  const t = useTranslations('CareerAdmin')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Filter>('PENDING')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  const { needsPick, universityId } = useCareerUniversity()
  const params = {
    page,
    limit,
    ...(status === 'ALL' ? {} : { status }),
    ...(universityId ? { universityId } : {}),
  }
  const query = useQuery({
    queryKey: vacancyKeys.reviewQueue(params),
    queryFn: () => fetchVacancyReviewQueue(params),
    enabled: !needsPick || !!universityId,
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
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

  // Новый фильтр или размер страницы — снова с первой: на прежней странице
  // отфильтрованного списка может не быть строк вовсе.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }

  // Заявка, по которой спрашиваем причину отказа.
  const [asking, setAsking] = useState<string | null>(null)

  const statusLabel: Record<VacancyReviewStatus, string> = {
    PENDING: t('statusPending'),
    APPROVED: t('statusApproved'),
    REJECTED: t('statusRejected'),
  }

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

      {needsPick && !universityId ? (
        <CareerUniversityRequired />
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<Briefcase className="size-6" aria-hidden />}
          title={t('noVacancies')}
          description={t('noVacanciesHint')}
        />
      ) : (
        <>
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colVacancy')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('colCompany')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('colDescription')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead className="text-right">{t('colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && <TableSkeletonRows columns={5} />}
                {rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <TableText value={row.vacancy.title} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      <TableText value={row.vacancy.company.name} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {/* Описание и причина отказа делят колонку: у решённой заявки важнее
                          причина, у ожидающей её просто нет. */}
                      <TableText value={row.reason ?? row.vacancy.description} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'APPROVED' ? 'secondary' : 'outline'}>
                        {statusLabel[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === 'PENDING' && (
                        <span className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: row.id, status: 'APPROVED' })}
                          >
                            {t('approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            onClick={() => setAsking(row.id)}
                          >
                            {t('reject')}
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              limit={limit}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => refilter(() => setLimit(n))}
            />
          </Card>
        </>
      )}

      {/* Причина отказа обязательна — спрашиваем диалогом, а не раскрытием строки:
          форма внутри строки ломала бы колонки таблицы. */}
      <PromptDialog
        open={asking !== null}
        title={t('decisionReason')}
        placeholder={t('reasonPlaceholder')}
        multiline
        required
        submitLabel={t('reject')}
        cancelLabel={t('cancel')}
        onSubmit={(reason) => {
          if (asking) decide.mutate({ id: asking, status: 'REJECTED', reason })
          setAsking(null)
        }}
        onClose={() => setAsking(null)}
      />
    </div>
  )
}
