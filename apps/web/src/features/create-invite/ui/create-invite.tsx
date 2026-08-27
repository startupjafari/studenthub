'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useLocale, useTranslations } from 'next-intl'
import { Plus, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  TableSkeletonRows,
  TableText,
  useConfirm,
  useSortState,
} from '../../../shared/ui'
import { fetchMe, userKeys } from '../../../entities/user'
import {
  fetchInvites,
  inviteKeys,
  revokeInviteRequest,
  type InviteStatus,
} from '../../../entities/invite'
import { cn } from '../../../shared/lib/utils'
import type { InviteSortValue } from '@studenthub/shared-schemas'
import { INVITABLE_ROLES } from '../model/invitable-roles'
import { BulkInvite } from './bulk-invite'
import { CreateInviteModal } from './create-invite-modal'

function errCode(e: unknown): string {
  return (e as { code?: string }).code ?? 'INTERNAL_ERROR'
}

const STATUS_VARIANT: Record<InviteStatus, 'info' | 'success' | 'secondary'> = {
  PENDING: 'info',
  USED: 'success',
  EXPIRED: 'secondary',
  REVOKED: 'secondary',
}

// Размеры страницы. Потолок 100 — столько разрешает OffsetPaginationSchema, на которой
// построен GET /invites; ADMIN_PAGE_SIZES с его 150 и 200 здесь дал бы 422.
const PAGE_SIZES = [20, 50, 100] as const
// Ширины колонок: роль · email · статус · действует до · создано · «отозвать».
const COLS = ['20%', '30%', '14%', '16%', '16%', '3.5rem'] as const
// На узком экране остаются роль, статус и срок — без email и даты создания список читается.
const HIDE = {
  email: 'hidden md:table-cell',
  createdAt: 'hidden lg:table-cell',
} as const
// Порядок классов = порядок колонок (см. COLS): скелетон обязан прятать те же колонки,
// что и шапка, иначе во время загрузки строки шире шапки и колонки разъезжаются.
const SKELETON_COLS = [undefined, HIDE.email, undefined, undefined, HIDE.createdAt, undefined]

// Экран приглашений: список выданных таблицей, выдача — в модалке из шапки.
// Форма занимала верх страницы постоянно, хотя выдача разовая, а смотрят чаще список.
export function CreateInvite() {
  const t = useTranslations('Invites')
  const tErr = useTranslations('Errors')
  const tRoles = useTranslations('Roles')
  const locale = useLocale()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])

  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  // Сортировка серверная: упорядочена вся выборка, а не открытая страница.
  const { sort, toggle } = useSortState()
  const query = {
    page,
    limit,
    ...(sort ? { sort: sort.key as InviteSortValue, order: sort.dir } : {}),
  }
  const invites = useQuery({
    queryKey: inviteKeys.list(query),
    queryFn: () => fetchInvites(query),
    // Прежние строки остаются на экране, пока грузится следующая страница, — таблица
    // не мигает пустотой на каждом переключении.
    placeholderData: (prev) => prev,
  })
  const rowsOnPage = invites.data?.items ?? []
  const total = invites.data?.total ?? 0

  const invitable = me.data ? (INVITABLE_ROLES[me.data.role] ?? []) : []

  const revokeMut = useMutation({
    mutationFn: revokeInviteRequest,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inviteKeys.all })
      toast.success(t('revoked'))
    },
    onError: (e) => toast.error(tErr(errCode(e))),
  })

  const rows = rowsOnPage

  const fmt = (iso: string): string => new Date(iso).toLocaleDateString(locale)

  if (invitable.length === 0 && !me.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('title')} />
        <EmptyState title={t('cannotInvite')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={t('title')}
        actions={
          <>
            <BulkInvite />
            <Button type="button" size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('create')}
            </Button>
          </>
        }
      />

      {!invites.isLoading && total === 0 ? (
        <EmptyState
          title={t('noInvites')}
          description={t('noInvitesHint')}
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden />
              {t('create')}
            </Button>
          }
        />
      ) : (
        // Загрузка идёт скелетоном в строках: шапка и ширины колонок остаются на месте.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={COLS}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="role" sort={sort} onSort={toggle}>
                  {t('roleLabel')}
                </TableHead>
                <TableHead sortKey="email" sort={sort} onSort={toggle} className={HIDE.email}>
                  {t('emailLabel')}
                </TableHead>
                <TableHead sortKey="status" sort={sort} onSort={toggle}>
                  {t('colStatus')}
                </TableHead>
                <TableHead sortKey="expiresAt" sort={sort} onSort={toggle}>
                  {t('expires')}
                </TableHead>
                <TableHead
                  sortKey="createdAt"
                  sort={sort}
                  onSort={toggle}
                  className={HIDE.createdAt}
                >
                  {t('colCreated')}
                </TableHead>
                <TableHead>
                  <span className="sr-only">{t('actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.isLoading && <TableSkeletonRows columns={SKELETON_COLS} />}
              {rows.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <TableText value={tRoles(inv.role)} />
                  </TableCell>
                  <TableCell className={HIDE.email}>
                    {inv.email ? <TableText value={inv.email} /> : <TableEmpty />}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    <TableText value={fmt(inv.expiresAt)} />
                  </TableCell>
                  <TableCell className={cn(HIDE.createdAt, 'text-muted-foreground tabular-nums')}>
                    <TableText value={fmt(inv.createdAt)} />
                  </TableCell>
                  <TableCell>
                    {/* Отзывать можно только ещё живое приглашение: использованное,
                        истёкшее и уже отозванное отзывать нечего. */}
                    {inv.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label={t('revoke')}
                        loading={revokeMut.isPending && revokeMut.variables === inv.id}
                        onClick={() => {
                          void confirm({ title: t('revokeConfirm'), destructive: true }).then(
                            (ok) => {
                              if (ok) revokeMut.mutate(inv.id)
                            },
                          )
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    )}
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
            // Размер страницы сменился — возвращаемся на первую: страница 5 при 100 строках
            // на странице может просто не существовать.
            onLimitChange={(n) => {
              setLimit(n)
              setPage(1)
            }}
          />
        </Card>
      )}

      {createOpen && <CreateInviteModal onClose={() => setCreateOpen(false)} />}
    </div>
  )
}
