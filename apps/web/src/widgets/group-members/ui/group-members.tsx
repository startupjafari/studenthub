'use client'

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { fetchGroupMembers, groupKeys, type GroupMember } from '../../../entities/group'
import { ProfileLink } from '../../../entities/user'
import { cn } from '../../../shared/lib/utils'
import {
  Avatar,
  AvatarFallback,
  Card,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableText,
  useTableSort,
} from '../../../shared/ui'

interface GroupMembersProps {
  groupId: string | null
  // Показывать только студентов (экран «одногруппники»).
  studentsOnly?: boolean
  /**
   * Занять всю высоту области контента и прокручивать тело таблицы — как на остальных
   * страницах со списками. Включают только отдельные экраны («Моя группа»,
   * «Одногруппники»); внутри раскрытой группы у админа вуза высоты не задано, и
   * растягиваться таблице там не во что.
   */
  fill?: boolean
}

// Участник · роль. Роли фиксированной ширины: длиннее «Администратор университета» строк нет.
const COLS = ['70%', '30%'] as const
const COLS_NARROW = ['60%', '40%'] as const

export function GroupMembers({ groupId, studentsOnly = false, fill = false }: GroupMembersProps) {
  const t = useTranslations('People')
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')

  const members = useQuery({
    queryKey: groupKeys.members(groupId ?? ''),
    queryFn: () => fetchGroupMembers(groupId as string),
    enabled: !!groupId,
  })

  const list = (members.data ?? []).filter((m) => !studentsOnly || m.role === Role.STUDENT)

  // Сортировка клиентская: список участников группы приходит целиком, отдельного запроса
  // на сортировку нет. Роль сравнивается по переводу — пользователь видит алфавит своего
  // языка, а не порядок значений enum.
  const value = useCallback(
    (m: GroupMember, key: string) =>
      key === 'role' ? tRoles(m.role) : `${m.lastName} ${m.firstName}`,
    [tRoles],
  )
  // Без начальной сортировки: пока пользователь не нажал заголовок, строки идут в порядке
  // бэкенда (фамилия, затем имя), и ни одна колонка не помечена как сортируемая.
  const { rows, sort, toggle } = useTableSort(list, value)

  if (!groupId) {
    return <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('noGroup')} />
  }
  if (members.isError) return <EmptyState title={tErr('INTERNAL_ERROR')} />
  if (!members.isLoading && list.length === 0) {
    return <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('empty')} />
  }

  return (
    // `gap-0 py-0`: собственные отступы карточки дали бы полосу над шапкой таблицы и
    // просвет под последней строкой — таблица занимает карточку целиком.
    <Card className={cn('gap-0 py-0', fill && 'flex min-h-0 flex-1 flex-col')}>
      <Table fixed scrollBody={fill} fill={fill} cols={COLS} colsNarrow={COLS_NARROW}>
        <TableHeader>
          <TableRow>
            <TableHead sortKey="name" sort={sort} onSort={toggle}>
              {t('colName')}
            </TableHead>
            <TableHead sortKey="role" sort={sort} onSort={toggle}>
              {t('colRole')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.isLoading && <TableSkeletonRows columns={2} />}
          {rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <ProfileLink userId={m.id} className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback>
                      {(m.lastName[0] ?? '') + (m.firstName[0] ?? '')}
                    </AvatarFallback>
                  </Avatar>
                  <TableText value={`${m.lastName} ${m.firstName}`} className="font-medium" />
                </ProfileLink>
              </TableCell>
              <TableCell className="text-muted-foreground">{tRoles(m.role)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
