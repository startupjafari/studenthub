'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Clock, GraduationCap, Search, ShieldX, Undo2 } from 'lucide-react'
import {
  isAccessActive,
  type CompanyAccessStatus,
  type CompanyUniversityFilter,
  type CompanyUniversitySort,
} from '@studenthub/shared-schemas'
import {
  companyKeys,
  fetchCompanyUniversityOptions,
  fetchMyCompany,
  isCompanyOwner,
  requestCompanyAccess,
  type CompanyUniversityOption,
} from '../../../entities/company'
import { useKatoNames } from '../../../entities/kato'
import { universityPath } from '../../../entities/university'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
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
  usePagedSort,
} from '../../../shared/ui'
import { toApiError } from '../../../shared/lib'

/** Вкладка фильтра: 'ALL' — не значение сервера, а «без фильтра». */
type AccessFilter = CompanyUniversityFilter | 'ALL'

// Список на OffsetPaginationSchema (limit ≤ 100): больший размер страницы дал бы 422.
const PAGE_SIZES = [20, 50, 100] as const
const DEBOUNCE_MS = 300
const SEARCH_MAX = 120
const COLS = ['40%', '20%', '22%', '18%'] as const
const COLS_READONLY = ['48%', '24%', '28%'] as const

/**
 * Заявки в вузы. Доступ к студентам открывает университет — здесь компания видит,
 * где он уже открыт, где заявка на рассмотрении и где было отказано (с причиной).
 *
 * Вузов на платформе сотни: поиск, фильтр, сортировка и страницы — на сервере. Раньше
 * сервер отдавал первые 50 по алфавиту, и вуз дальше по списку находился только поиском.
 */
export function EmployerAccessView() {
  const t = useTranslations('Employer')
  const tErr = useTranslations('Errors')
  const queryClient = useQueryClient()
  const table = usePagedSort<CompanyUniversitySort>(PAGE_SIZES[0])
  const { setPage } = table
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [filter, setFilter] = useState<AccessFilter>('ALL')
  // Вуз, в который подаётся заявка: сообщение спрашиваем диалогом, а не раскрывая строку
  // таблицы — форма внутри строки ломала бы колонки.
  const [requesting, setRequesting] = useState<CompanyUniversityOption | null>(null)

  // Запрос — после паузы в наборе, со сбросом на первую страницу: иначе каждая буква
  // уходила бы отдельным запросом, а пятая страница нового поиска могла оказаться пустой.
  useEffect(() => {
    const next = search.trim().slice(0, SEARCH_MAX)
    if (next === debounced) return
    const timer = setTimeout(() => {
      setDebounced(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, debounced, setPage])

  // Заявку в вуз подаёт только владелец компании: рекрутёр видит статусы, но не кнопки.
  const company = useQuery({ queryKey: companyKeys.mine(), queryFn: fetchMyCompany })
  const canRequest = isCompanyOwner(company.data)

  const params = {
    ...table.query,
    ...(debounced ? { search: debounced } : {}),
    ...(filter === 'ALL' ? {} : { access: filter }),
  }
  const options = useQuery({
    queryKey: companyKeys.universityOptions(params),
    queryFn: () => fetchCompanyUniversityOptions(params),
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })

  const request = useMutation({
    mutationFn: ({ universityId, message }: { universityId: string; message: string }) =>
      requestCompanyAccess({ universityId, message: message || undefined }),
    onSuccess: async () => {
      setRequesting(null)
      toast.success(t('requestSent'))
      await queryClient.invalidateQueries({ queryKey: companyKeys.all })
    },
    onError: (error) => toast.error(tErr(toApiError(error).code)),
  })

  const rows = options.data?.items ?? []
  // Город вуза хранится кодом КАТО — показываем название на языке интерфейса.
  const { nameOf: cityName } = useKatoNames(rows.map((u) => u.city))
  const total = options.data?.total ?? 0
  const filtered = !!debounced || filter !== 'ALL'

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <PageHeader
        title={t('accessTitle')}
        subtitle={t('accessSubtitle')}
        tabs={
          <SegmentedTabs<AccessFilter>
            aria-label={t('accessFilter')}
            items={[
              { value: 'ALL', label: t('filterAll') },
              { value: 'APPROVED', label: t('statusApproved') },
              { value: 'REQUESTED', label: t('statusRequested') },
              { value: 'NONE', label: t('filterNone') },
            ]}
            value={filter}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
          />
        }
        // Поиск — в шапке справа от вкладок: таблица начинается сразу, без отдельной строки.
        actions={
          <div className="relative w-full sm:w-64">
            <Search
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              size="md"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchUniversity')}
              aria-label={t('searchUniversity')}
              className="pl-9"
            />
          </div>
        }
      />
      {company.data && !canRequest && (
        <p className="text-sm text-muted-foreground">{t('ownerOnlyAccess')}</p>
      )}

      {options.isError ? (
        // Ошибку показываем именно ошибкой: 403 или обрыв сети, отрисованные как
        // «пусто», выглядят как «данных нет» и прячут настоящую причину.
        <EmptyState
          title={tErr(toApiError(options.error).code)}
          description={tErr('retryHint')}
          action={
            <Button variant="outline" onClick={() => void options.refetch()}>
              {t('retry')}
            </Button>
          }
        />
      ) : rows.length === 0 && !options.isLoading ? (
        <EmptyState
          icon={<GraduationCap className="size-6" aria-hidden />}
          title={t('noUniversities')}
          description={filtered ? t('noUniversitiesHint') : undefined}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={canRequest ? COLS : COLS_READONLY}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={table.sort} onSort={table.toggle}>
                  {t('colUniversity')}
                </TableHead>
                <TableHead className="hidden sm:table-cell">{t('colCity')}</TableHead>
                <TableHead>{t('colAccess')}</TableHead>
                {canRequest && <TableHead className="text-right">{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {options.isLoading && <TableSkeletonRows columns={canRequest ? 4 : 3} />}
              {rows.map((u) => (
                <TableRow key={u.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    {/* Страница вуза открыта компании, пока допуск действует. */}
                    {u.access?.status === 'APPROVED' && isAccessActive(u.access) ? (
                      <Link
                        href={universityPath(u.id)}
                        className="block truncate text-primary hover:underline"
                      >
                        {u.name}
                      </Link>
                    ) : (
                      <TableText value={u.name} />
                    )}
                    {/* Город на телефоне — под названием: своя колонка скрыта. */}
                    {u.city && (
                      <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                        {cityName(u.city)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    <TableText value={cityName(u.city)} />
                  </TableCell>
                  <TableCell>
                    <AccessBadge option={u} />
                    {u.access?.reason && (
                      <span
                        className="mt-0.5 block truncate text-xs text-muted-foreground"
                        title={u.access.reason}
                      >
                        {t('decisionReason')}: {u.access.reason}
                      </span>
                    )}
                  </TableCell>
                  {canRequest && (
                    <TableCell className="text-right">
                      {canApply(u) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={request.isPending}
                          onClick={() => setRequesting(u)}
                        >
                          {u.access ? t('requestAgain') : t('requestAccess')}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={table.page}
            limit={table.limit}
            total={total}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={table.setLimit}
          />
        </Card>
      )}

      <PromptDialog
        open={requesting !== null}
        title={requesting ? t('requestTo', { name: requesting.name }) : t('requestMessage')}
        placeholder={t('requestMessagePlaceholder')}
        multiline
        submitLabel={t('sendRequest')}
        cancelLabel={t('cancel')}
        onSubmit={(message) => {
          if (requesting) request.mutate({ universityId: requesting.id, message })
        }}
        onClose={() => setRequesting(null)}
      />
    </div>
  )
}

/**
 * Можно ли подать заявку: доступа нет вовсе, отказали, отозвали или срок истёк. Срок
 * проверяется в каждом запросе, а в REVOKED его переводит ежечасный cron: одобренный, но
 * истёкший допуск — уже не «Доступ открыт».
 */
function canApply(option: CompanyUniversityOption): boolean {
  const status = option.access?.status
  if (!status) return true
  if (status === 'REQUESTED') return false
  if (status === 'APPROVED') return !isAccessActive(option.access)
  return true
}

/** Состояние своей заявки в вуз. Без заявки — прочерк. */
function AccessBadge({ option }: { option: CompanyUniversityOption }) {
  const t = useTranslations('Employer')
  const status = option.access?.status
  if (!status) return <TableText value={null} />

  if (status === 'APPROVED' && isAccessActive(option.access)) {
    return (
      <Badge variant="success" className="gap-1">
        <Check className="size-3.5" aria-hidden />
        {t('statusApproved')}
      </Badge>
    )
  }
  if (status === 'REQUESTED') {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="size-3.5" aria-hidden />
        {t('statusRequested')}
      </Badge>
    )
  }

  // Отказ и отзыв различаем: после отзыва компания знала доступ и потеряла его, после
  // отказа — не получала.
  const label: Record<Exclude<CompanyAccessStatus, 'REQUESTED'>, string> = {
    APPROVED: t('statusExpired'),
    REJECTED: t('statusRejected'),
    REVOKED: t('statusRevoked'),
  }
  return (
    <Badge variant="secondary" className="gap-1">
      {status === 'REJECTED' ? (
        <ShieldX className="size-3.5" aria-hidden />
      ) : (
        <Undo2 className="size-3.5" aria-hidden />
      )}
      {label[status]}
    </Badge>
  )
}
