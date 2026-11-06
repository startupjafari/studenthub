'use client'

import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  EmptyState,
  Modal,
  Skeleton,
} from '../../../shared/ui'
import { AssignStarosta } from '../../../features/assign-starosta'
import { fetchGroupMembers, groupKeys, type Group } from '../../../entities/group'
import { ProfileLink } from '../../../entities/user'

function initials(f: string, l: string): string {
  return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase()
}

interface GroupMembersModalProps {
  group: Group
  onClose: () => void
}

// Состав группы и назначение старосты. Раньше это был разворот карточки в списке; в таблице
// строку не развернуть, поэтому состав открывается окном — тем же, что по клику на название.
export function GroupMembersModal({ group, onClose }: GroupMembersModalProps) {
  const t = useTranslations('UniAdmin')
  const tRoles = useTranslations('Roles')

  const members = useQuery({
    queryKey: groupKeys.members(group.id),
    queryFn: () => fetchGroupMembers(group.id),
  })

  return (
    <Modal onClose={onClose} title={t('groupMembersTitle', { name: group.name })} size="lg">
      {members.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : members.data && members.data.length > 0 ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {members.data.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <ProfileLink userId={m.id} className="flex min-w-0 items-center gap-2">
                  <Avatar className="size-7">
                    {m.avatarUrl && <AvatarImage src={m.avatarUrl} alt="" />}
                    <AvatarFallback className="text-xs">
                      {initials(m.firstName, m.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">
                    {m.firstName} {m.lastName}
                  </span>
                </ProfileLink>
                <span className="shrink-0 text-xs text-muted-foreground">{tRoles(m.role)}</span>
                {group.starostaId === m.id && (
                  <Badge variant="info" className="ml-auto">
                    {t('starosta')}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <AssignStarosta group={group} members={members.data} />
        </div>
      ) : (
        <EmptyState title={t('noMembers')} className="border-0 p-6" />
      )}
    </Modal>
  )
}
