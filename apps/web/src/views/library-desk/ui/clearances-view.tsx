'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFormatter, useTranslations } from 'next-intl'
import { FileCheck2, ShieldX } from 'lucide-react'
import type { ClearanceCertificateItem } from '@studenthub/shared-schemas'
import {
  Badge,
  Button,
  Card,
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
import { fetchClearances, libraryKeys, revokeClearanceRequest } from '../../../entities/library'
import { useDeskErrors } from '../lib/desk-errors'

// Справки «задолженностей нет» у библиотекаря (Фаза 21.C4): какие справки выдали студенты
// своего вуза, с кодом проверки и статусом. Справку можно отозвать с причиной — бумага у
// человека останется, но проверка по коду покажет «отозвана». Таблица во всю высоту
// (DESIGN_SYSTEM §10.7), фильтр — в шапке, как у броней.

const PAGE_SIZES = [20, 50, 100] as const

type Filter = 'active' | 'revoked' | 'all'

// Код · читатель · выдана · статус · действие.
const COLS = ['18%', '36%', '16%', 'calc(30% - 3.5rem)', '3.5rem'] as const
const COLS_NARROW = ['35%', '0', '0', 'calc(65% - 3.5rem)', '3.5rem'] as const
const HIDE = { reader: 'hidden md:table-cell', issued: 'hidden lg:table-cell' } as const
const SKELETON_COLS = [undefined, HIDE.reader, HIDE.issued, undefined, undefined]

export function ClearancesView() {
  const t = useTranslations('LibraryDesk')
  const tCommon = useTranslations('Common')
  const format = useFormatter()
  const describe = useDeskErrors()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('active')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  const [revoking, setRevoking] = useState<ClearanceCertificateItem | null>(null)

  const params = { status: filter, page, limit }
  const list = useQuery({
    queryKey: libraryKeys.clearances(params),
    queryFn: () => fetchClearances(params),
    placeholderData: keepPreviousData,
  })
  const items = list.data?.items ?? []

  const revokeMut = useMutation({
    mutationFn: ({ code, reason }: { code: string; reason: string }) =>
      revokeClearanceRequest(code, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: libraryKeys.all })
      toast.success(t('clearanceRevokedToast'))
      setRevoking(null)
    },
    onError: (e) => void toast.error(describe(e)),
  })

  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <PageHeader
        title={t('clearancesTitle')}
        subtitle={t('clearancesSubtitle')}
        tabs={
          <SegmentedTabs<Filter>
            value={filter}
            aria-label={t('filter')}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
            items={[
              { value: 'active', label: t('clearanceFilterActive') },
              { value: 'revoked', label: t('clearanceFilterRevoked') },
              { value: 'all', label: t('filterAll') },
            ]}
          />
        }
      />

      {list.isError ? (
        <EmptyState
          icon={<FileCheck2 className="size-6" aria-hidden />}
          title={t('clearancesLoadError')}
          action={
            <Button type="button" variant="outline" onClick={() => void list.refetch()}>
              {tCommon('retry')}
            </Button>
          }
        />
      ) : items.length === 0 && !list.isPending ? (
        <EmptyState
          icon={<FileCheck2 className="size-6" aria-hidden />}
          title={t('noClearances')}
        />
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS} colsNarrow={COLS_NARROW}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colCode')}</TableHead>
                <TableHead className={HIDE.reader}>{t('colReader')}</TableHead>
                <TableHead className={HIDE.issued}>{t('colIssued')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('clearanceRevoke')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending && <TableSkeletonRows columns={SKELETON_COLS} />}
              {items.map((c) => (
                <TableRow key={c.code}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-sm tracking-wider tabular-nums">
                        {c.code}
                      </span>
                      <span className="truncate text-xs text-muted-foreground md:hidden">
                        {c.reader.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={HIDE.reader}>
                    <TableText value={c.reader.name ?? ''} />
                  </TableCell>
                  <TableCell className={HIDE.issued}>
                    <span className="text-sm">{day(c.issuedAt)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.revokedAt ? 'destructive' : 'success'}>
                      {c.revokedAt
                        ? t('clearanceRevokedAt', { date: day(c.revokedAt) })
                        : t('clearanceValid')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!c.revokedAt && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon
                          aria-label={t('clearanceRevoke')}
                          title={t('clearanceRevoke')}
                          loading={revokeMut.isPending && revoking?.code === c.code}
                          onClick={() => setRevoking(c)}
                        >
                          <ShieldX className="size-4" aria-hidden />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={page}
            total={list.data?.total ?? 0}
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
      <PromptDialog
        open={revoking !== null}
        title={
          revoking
            ? t('clearanceRevokeTitle', { code: revoking.code, name: revoking.reader.name ?? '' })
            : ''
        }
        placeholder={t('clearanceRevokeReason')}
        multiline
        required
        submitLabel={t('clearanceRevoke')}
        cancelLabel={tCommon('cancel')}
        onSubmit={(reason) => {
          if (revoking) revokeMut.mutate({ code: revoking.code, reason })
        }}
        onClose={() => setRevoking(null)}
      />
    </div>
  )
}
