'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Building2, ExternalLink } from 'lucide-react'
import { ADMIN_PAGE_SIZES } from '@studenthub/shared-schemas'
import type {
  CompanyAccessStatus,
  CompanySort,
  DecideCompanyAccessInput,
} from '@studenthub/shared-schemas'
import {
  companyKeys,
  decideCompanyAccess,
  fetchUniversityCompanyAccess,
} from '../../../entities/company'
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
  useSortState,
} from '../../../shared/ui'
import {
  CareerUniversityRequired,
  useCareerUniversity,
} from '../../../features/career-university-scope'
import { toApiError } from '../../../shared/lib'

/** Фильтр очереди. 'ALL' — не статус, а «показать все», поэтому отдельным типом. */
type StatusFilter = CompanyAccessStatus | 'ALL'

// Ширины колонок: имя компании и решение важнее контактов, поэтому им отдано больше места.
// Размеры страницы — общий для админских экранов набор из контракта.
const PAGE_SIZES = ADMIN_PAGE_SIZES

const COLS = ['26%', '22%', '28%', '10%', '14%'] as const

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
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  const { needsPick, universityId } = useCareerUniversity()
  const { sort, toggle } = useSortState()
  const params = {
    page,
    limit,
    ...(status === 'ALL' ? {} : { status }),
    ...(universityId ? { universityId } : {}),
    ...(sort ? { sort: sort.key as CompanySort, order: sort.dir } : {}),
  }
  const query = useQuery({
    queryKey: companyKeys.universityAccess(params),
    queryFn: () => fetchUniversityCompanyAccess(params),
    enabled: !needsPick || !!universityId,
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })

  const decide = useMutation({
    // Вуз, от имени которого принимается решение. Платформенной роли он в токене не
    // достаётся, а выбирается один раз на «Обзоре» и живёт в адресе страницы — в
    // ЗАПРОСАХ он уходит параметром, в РЕШЕНИЯХ полем тела (PROJECT.md §678). Без него
    // список грузился, но «Одобрить» отвечал 403 «Выберите университет».
    // Сотрудник вуза шлёт undefined: его вуз берётся из токена, и подменить его нельзя.
    mutationFn: ({ id, input }: { id: string; input: DecideCompanyAccessInput }) =>
      decideCompanyAccess(id, { ...input, ...(universityId ? { universityId } : {}) }),
    onSuccess: async () => {
      toast.success(t('decisionSaved'))
      await queryClient.invalidateQueries({ queryKey: companyKeys.all })
    },
    onError: (error) => toast.error(toApiError(error).message),
  })

  const rows = query.data?.items ?? []

  // Новый фильтр или размер страницы — снова с первой: на прежней странице
  // отфильтрованного списка может не быть строк вовсе.
  const sortBy = (key: string): void => refilter(() => toggle(key))

  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }
  const total = query.data?.total ?? 0

  // Заявка, по которой спрашиваем причину отказа или отзыва.
  const [asking, setAsking] = useState<null | { id: string; status: 'REJECTED' | 'REVOKED' }>(null)

  const statusLabel: Record<CompanyAccessStatus, string> = {
    REQUESTED: t('statusRequested'),
    APPROVED: t('statusApproved'),
    REJECTED: t('statusRejected'),
    REVOKED: t('statusRevoked'),
  }

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

      {needsPick && !universityId ? (
        <CareerUniversityRequired />
      ) : query.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState title={tErr(toApiError(query.error).code)} description={tErr('retryHint')} />
      ) : rows.length === 0 && !query.isLoading ? (
        <EmptyState
          icon={<Building2 className="size-6" aria-hidden />}
          title={t('noCompanies')}
          description={t('noCompaniesHint')}
        />
      ) : (
        <>
          <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
            <Table fixed scrollBody fill cols={COLS}>
              <TableHeader>
                <TableRow>
                  <TableHead sortKey="name" sort={sort} onSort={sortBy}>
                    {t('colCompany')}
                  </TableHead>
                  <TableHead className="hidden md:table-cell">{t('colContacts')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('colMessage')}</TableHead>
                  <TableHead sortKey="status" sort={sort} onSort={sortBy}>
                    {t('colStatus')}
                  </TableHead>
                  <TableHead className="text-right">{t('colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading && <TableSkeletonRows columns={5} />}
                {rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <TableText value={row.company.name} />
                      {row.company.city && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {row.company.city}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {row.company.website ? (
                        <a
                          href={row.company.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          <span className="truncate">{row.company.website}</span>
                          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        <TableText value={null} />
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {/* Сообщение компании и причина решения — про одно и то же обращение,
                          поэтому в таблице делят колонку: что-то одно из них и заполнено. */}
                      <TableText value={row.reason ?? row.message} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[row.status]}>{statusLabel[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="flex justify-end gap-2">
                        {row.status === 'REQUESTED' && (
                          <>
                            <Button
                              size="sm"
                              disabled={decide.isPending}
                              onClick={() =>
                                decide.mutate({ id: row.id, input: { status: 'APPROVED' } })
                              }
                            >
                              {t('approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decide.isPending}
                              onClick={() => setAsking({ id: row.id, status: 'REJECTED' })}
                            >
                              {t('reject')}
                            </Button>
                          </>
                        )}
                        {row.status === 'APPROVED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decide.isPending}
                            onClick={() => setAsking({ id: row.id, status: 'REVOKED' })}
                          >
                            {t('revoke')}
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page}
              limit={limit}
              total={total}
              onPageChange={setPage}
              limitOptions={PAGE_SIZES}
              onLimitChange={(n) => refilter(() => setLimit(n))}
            />
          </Card>
        </>
      )}

      {/* Причина отказа и отзыва обязательна — её спрашиваем диалогом, а не разворачивая
          строку таблицы: раскрытая форма внутри строки ломала бы колонки. */}
      <PromptDialog
        open={asking !== null}
        title={t('decisionReason')}
        placeholder={t('reasonPlaceholder')}
        multiline
        required
        submitLabel={asking?.status === 'REVOKED' ? t('revoke') : t('reject')}
        cancelLabel={t('cancel')}
        onSubmit={(reason) => {
          if (asking) decide.mutate({ id: asking.id, input: { status: asking.status, reason } })
          setAsking(null)
        }}
        onClose={() => setAsking(null)}
      />
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
