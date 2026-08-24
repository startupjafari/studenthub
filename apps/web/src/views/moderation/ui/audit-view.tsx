'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ScrollText } from 'lucide-react'
import { ADMIN_PAGE_SIZES, type AuditSortValue } from '@studenthub/shared-schemas'
import { auditKeys, fetchAudit } from '../../../entities/audit'
import {
  Card,
  EmptyState,
  Input,
  PageHeader,
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

const PAGE_SIZES = ADMIN_PAGE_SIZES
// Ширины колонок: время · действие · объект · пользователь.
const COLS = ['20%', '28%', '28%', '24%'] as const

export function AuditView() {
  const t = useTranslations('Moderation')
  const tErr = useTranslations('Errors')
  const locale = useLocale()
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  // Сортировка серверная (sort/order в запросе): упорядочен весь журнал, а не страница.
  const { sort, toggle } = useSortState()

  const query = {
    ...(action ? { action } : {}),
    ...(sort ? { sort: sort.key as AuditSortValue, order: sort.dir } : {}),
    page,
    limit,
  }
  const audit = useQuery({
    queryKey: auditKeys.list(query),
    queryFn: () => fetchAudit(query),
    // Прошлая страница остаётся на экране, пока грузится новая.
    placeholderData: keepPreviousData,
  })
  const total = audit.data?.total ?? 0
  const rows = audit.data?.items ?? []

  // Новый фильтр или порядок — снова с первой страницы.
  const sortBy = (key: string): void => {
    toggle(key)
    setPage(1)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Фильтр — в шапке (DESIGN_SYSTEM §10.1): управление списком стоит рядом с
          заголовком, а не отдельной строкой над таблицей. */}
      <PageHeader
        icon={ScrollText}
        title={t('auditTitle')}
        subtitle={t('auditSubtitle')}
        actions={
          <Input
            value={action}
            onChange={(e) => {
              setAction(e.target.value.trim())
              setPage(1)
            }}
            placeholder={t('filterAction')}
            className="h-9 w-full text-sm sm:w-64"
          />
        }
      />

      {audit.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !audit.isLoading && rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" aria-hidden />} title={t('auditEmpty')} />
      ) : (
        // Загрузка идёт скелетоном в строках, таблица остаётся на экране целиком.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="createdAt" sort={sort} onSort={sortBy}>
                  {t('colTime')}
                </TableHead>
                <TableHead sortKey="action" sort={sort} onSort={sortBy}>
                  {t('colAction')}
                </TableHead>
                <TableHead sortKey="entity" sort={sort} onSort={sortBy}>
                  {t('colEntity')}
                </TableHead>
                <TableHead sortKey="userId" sort={sort} onSort={sortBy}>
                  {t('colUser')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.isLoading && <TableSkeletonRows columns={4} />}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString(locale, {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="font-medium">
                    <TableText value={r.action} />
                  </TableCell>
                  {/* Полные id, а не `slice(0, 8)`: колонка их обрежет сама, а в подсказке
                        значение целиком — и его можно скопировать для поиска по логам. */}
                  <TableCell className="text-muted-foreground">
                    {r.entity ? (
                      <TableText value={r.entityId ? `${r.entity} · ${r.entityId}` : r.entity} />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.userId ? <TableText value={r.userId} /> : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={setPage}
            limitOptions={PAGE_SIZES}
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </Card>
      )}
    </div>
  )
}
