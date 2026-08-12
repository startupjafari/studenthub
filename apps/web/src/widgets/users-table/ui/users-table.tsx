'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Ban, Download, ShieldCheck, Users as UsersIcon } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
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
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '../../../shared/ui'

interface UsersTableProps {
  title: string
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

export function UsersTable({ title, role, showRoleFilter = false }: UsersTableProps) {
  const t = useTranslations('Users')
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')
  const qc = useQueryClient()
  const viewerRole = useAppSelector((s) => s.auth.role)
  const canBlock = viewerRole !== null && CAN_BLOCK.includes(viewerRole)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')

  const effectiveRole = role ?? (roleFilter === 'all' ? undefined : roleFilter)
  const filters = {
    ...(effectiveRole ? { role: effectiveRole } : {}),
    ...(search ? { search } : {}),
  }

  const users = useQuery({
    queryKey: adminUserKeys.list(filters),
    queryFn: () => fetchUsers(filters),
  })

  const blockMut = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      blocked ? unblockUserRequest(id) : blockUserRequest(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminUserKeys.all })
      toast.success(t('updated'))
    },
    onError: (e) => toast.error(tErr((e as { code?: string }).code ?? 'INTERNAL_ERROR')),
  })

  function exportCsv(): void {
    const data = users.data ?? []
    const blob = new Blob(['﻿' + toCsv(data)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={title}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={(users.data?.length ?? 0) === 0}
          >
            <Download className="size-4" aria-hidden />
            {t('exportCsv')}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value.trim())}
          placeholder={t('searchPlaceholder')}
          className="max-w-xs"
        />
        {showRoleFilter && (
          <div className="w-52">
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as Role | 'all')}>
              <SelectTrigger>
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
          </div>
        )}
      </div>

      {users.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : users.isError ? (
        <EmptyState title={tErr('INTERNAL_ERROR')} />
      ) : (users.data?.length ?? 0) === 0 ? (
        <EmptyState icon={<UsersIcon className="size-6" aria-hidden />} title={t('empty')} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('colName')}</th>
                  <th className="px-4 py-2 font-medium">{t('colEmail')}</th>
                  <th className="px-4 py-2 font-medium">{t('colRole')}</th>
                  <th className="px-4 py-2 font-medium">{t('colStatus')}</th>
                  {canBlock && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.data!.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 font-medium">
                      <ProfileLink userId={u.id} className="hover:text-primary hover:underline">
                        {u.lastName} {u.firstName}
                      </ProfileLink>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2">{tRoles(u.role)}</td>
                    <td className="px-4 py-2">
                      {u.isBlocked ? (
                        <Badge variant="secondary" className="text-destructive">
                          {t('blocked')}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('active')}</span>
                      )}
                    </td>
                    {canBlock && (
                      <td className="px-4 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={blockMut.isPending && blockMut.variables?.id === u.id}
                          onClick={() => blockMut.mutate({ id: u.id, blocked: u.isBlocked })}
                          className={u.isBlocked ? 'text-emerald-600' : 'text-destructive'}
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
