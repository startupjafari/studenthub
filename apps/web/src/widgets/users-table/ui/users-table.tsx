'use client'

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Ban, Download, ShieldCheck, Users as UsersIcon } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { ADMIN_PAGE_SIZES, type UserSortValue } from '@studenthub/shared-schemas'
import { useAppSelector } from '../../../shared/store'
import {
  adminUserKeys,
  blockUserRequest,
  fetchUsers,
  ProfileLink,
  unblockUserRequest,
  type AdminUser,
} from '../../../entities/user'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

interface UsersTableProps {
  title: string
  subtitle?: string
  // Фиксированная роль (экраны студентов/преподавателей/деканов) — тогда фильтр роли скрыт.
  role?: Role
  showRoleFilter?: boolean
}

const FILTER_ROLES: Role[] = [
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
]
// Варианты размера страницы — те же, что разрешает серверная схема (предел 200).
const PAGE_SIZES = ADMIN_PAGE_SIZES
// Ширины колонок: имя · email · роль · статус · действие (последняя — только тем,
// кто может блокировать; без неё берём первые четыре).
const COLS = ['26%', '30%', '18%', '14%', '12%'] as const
const CAN_BLOCK: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
]

function toCsv(users: AdminUser[]): string {
  const head = ['id', 'email', 'lastName', 'firstName', 'role', 'blocked', 'createdAt']
  const rows = users.map((u) =>
    [u.id, u.email, u.lastName, u.firstName, u.role, u.isBlocked, u.createdAt]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  return [head.join(','), ...rows].join('\n')
}

export function UsersTable({ title, subtitle, role, showRoleFilter = false }: UsersTableProps) {
  const t = useTranslations('Users')
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const viewerRole = useAppSelector((s) => s.auth.role)
  const canBlock = viewerRole !== null && CAN_BLOCK.includes(viewerRole)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(PAGE_SIZES[0])
  // Сортировка серверная (sort/order в запросе) — упорядочены все записи выборки,
  // а не только открытая страница.
  const { sort, toggle } = useSortState()

  const effectiveRole = role ?? (roleFilter === 'all' ? undefined : roleFilter)
  const filters = {
    ...(effectiveRole ? { role: effectiveRole } : {}),
    ...(search ? { search } : {}),
    ...(sort ? { sort: sort.key as UserSortValue, order: sort.dir } : {}),
  }
  const query = { ...filters, page, limit }

  const users = useQuery({
    queryKey: adminUserKeys.list(query),
    queryFn: () => fetchUsers(query),
    // Прошлая страница остаётся на экране, пока грузится новая: иначе таблица
    // мигает скелетоном на каждый клик по стрелке.
    placeholderData: keepPreviousData,
  })
  const total = users.data?.total ?? 0
  const rows = users.data?.items ?? []

  // Новый фильтр или порядок — снова с первой страницы: на «странице 5» отфильтрованной
  // выборки может не быть строк вовсе, а после смены сортировки там уже другие строки.
  function refilter(apply: () => void): void {
    apply()
    setPage(1)
  }
  const sortBy = (key: string): void => refilter(() => toggle(key))

  const blockMut = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      blocked ? unblockUserRequest(id) : blockUserRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('updated'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  // Экспорт — по всей выборке фильтров, а не по видимой странице (лимит сервера — 200).
  async function exportCsv(): Promise<void> {
    const all = await fetchUsers({ ...filters, page: 1, limit: 200 })
    const blob = new Blob(['﻿' + toCsv(all.items)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Поиск, фильтр роли и экспорт — в шапке (DESIGN_SYSTEM §10.1): это управление
          списком, отдельной строки над таблицей оно не заслуживает. На узком экране
          шапка переносит их на вторую строку сама (flex-wrap). */}
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Input
              value={search}
              onChange={(e) => refilter(() => setSearch(e.target.value.trim()))}
              placeholder={t('searchPlaceholder')}
              size="md"
              className="w-40 sm:w-56"
            />
            {showRoleFilter && (
              <Select
                value={roleFilter}
                onValueChange={(v) => refilter(() => setRoleFilter(v as Role | 'all'))}
              >
                <SelectTrigger size="md" className="w-36 sm:w-44">
                  <SelectValue placeholder={t('allRoles')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allRoles')}</SelectItem>
                  {FILTER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tRoles(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button type="button" size="md" onClick={() => void exportCsv()} disabled={total === 0}>
              <Download className="size-4" aria-hidden />
              {t('exportCsv')}
            </Button>
          </>
        }
      />

      {users.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : !users.isLoading && rows.length === 0 ? (
        <EmptyState icon={<UsersIcon className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        // Загрузка идёт скелетоном в строках: шапка, ширины колонок и подвал остаются
        // на месте, экран не «прыгает», когда данные приходят.
        <Card className="flex min-h-0 flex-1 flex-col gap-0 py-0">
          <Table fixed scrollBody fill cols={canBlock ? COLS : COLS.slice(0, 4)}>
            <TableHeader>
              <TableRow>
                <TableHead sortKey="name" sort={sort} onSort={sortBy}>
                  {t('colName')}
                </TableHead>
                <TableHead sortKey="email" sort={sort} onSort={sortBy}>
                  {t('colEmail')}
                </TableHead>
                <TableHead sortKey="role" sort={sort} onSort={sortBy}>
                  {t('colRole')}
                </TableHead>
                <TableHead sortKey="blocked" sort={sort} onSort={sortBy}>
                  {t('colStatus')}
                </TableHead>
                {canBlock && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isLoading && <TableSkeletonRows columns={canBlock ? 5 : 4} />}
              {rows.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    <ProfileLink
                      userId={u.id}
                      className="block truncate hover:text-primary hover:underline"
                    >
                      {u.lastName} {u.firstName}
                    </ProfileLink>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <TableText value={u.email} />
                  </TableCell>
                  <TableCell>
                    <TableText value={tRoles(u.role)} />
                  </TableCell>
                  <TableCell>
                    {u.isBlocked ? (
                      <Badge variant="secondary" className="text-destructive">
                        {t('blocked')}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('active')}</span>
                    )}
                  </TableCell>
                  {canBlock && (
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={blockMut.isPending && blockMut.variables?.id === u.id}
                        onClick={() => blockMut.mutate({ id: u.id, blocked: u.isBlocked })}
                        className={u.isBlocked ? 'text-success' : 'text-destructive'}
                      >
                        {u.isBlocked ? (
                          <>
                            <ShieldCheck className="size-4" aria-hidden />
                            {t('unblock')}
                          </>
                        ) : (
                          <>
                            <Ban className="size-4" aria-hidden />
                            {t('block')}
                          </>
                        )}
                      </Button>
                    </TableCell>
                  )}
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
            // Новый размер страницы — снова с первой: «страницы 34» при 200 строках
            // на странице может уже не быть.
            onLimitChange={(n) => refilter(() => setLimit(n))}
          />
        </Card>
      )}
    </div>
  )
}
