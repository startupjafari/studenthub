'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { fetchGroupMembers, groupKeys } from '../../../entities/group'
import { ProfileLink } from '../../../entities/user'
import { Avatar, AvatarFallback, Card, CardContent, EmptyState, Skeleton } from '../../../shared/ui'

interface GroupMembersProps {
  groupId: string | null
  // Показывать только студентов (экран «одногруппники»).
  studentsOnly?: boolean
}

export function GroupMembers({ groupId, studentsOnly = false }: GroupMembersProps) {
  const t = useTranslations('People')
  const tRoles = useTranslations('Roles')
  const tErr = useTranslations('Errors')

  const members = useQuery({
    queryKey: groupKeys.members(groupId ?? ''),
    queryFn: () => fetchGroupMembers(groupId as string),
    enabled: !!groupId,
  })

  if (!groupId) {
    return <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('noGroup')} />
  }
  if (members.isLoading) return <Skeleton className="h-48 w-full" />
  if (members.isError) return <EmptyState title={tErr('INTERNAL_ERROR')} />

  const list = (members.data ?? []).filter((m) => !studentsOnly || m.role === Role.STUDENT)
  if (list.length === 0) {
    return <EmptyState icon={<Users className="size-6" aria-hidden />} title={t('empty')} />
  }

  return (
    <Card>
      <CardContent className="flex flex-col divide-y divide-border p-0">
        {list.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <ProfileLink userId={m.id} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar className="size-9">
                <AvatarFallback>{(m.lastName[0] ?? '') + (m.firstName[0] ?? '')}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {m.lastName} {m.firstName}
              </span>
            </ProfileLink>
            <span className="text-xs text-muted-foreground">{tRoles(m.role)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
