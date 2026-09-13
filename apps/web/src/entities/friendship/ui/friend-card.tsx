'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage, Card } from '../../../shared/ui'
import type { FriendUser } from '../api/friendship-api'

function fullName(u: FriendUser): string {
  return [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ')
}

function initials(u: FriendUser): string {
  return ((u.lastName[0] ?? '') + (u.firstName[0] ?? '')).toUpperCase()
}

// Карточка пользователя в списках друзей/заявок: аватар + имя + роль + слот действий справа.
export function FriendCard({ user, action }: { user: FriendUser; action?: ReactNode }) {
  const tRoles = useTranslations('Roles')
  return (
    <Card className="flex-row items-center gap-3 p-3">
      <Link href={`/profile/${user.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {/* Avatar из системы, а не голый <Image>: он сам показывает заглушку и когда
            ссылки нет, и когда картинка НЕ ЗАГРУЗИЛАСЬ (протухшая ссылка, недоступный
            MinIO). У <Image> второй случай давал иконку «битая картинка» — техническую
            поломку в списке людей. */}
        <Avatar className="size-12">
          <AvatarImage src={user.avatarThumbUrl ?? user.avatarUrl ?? undefined} alt="" />
          <AvatarFallback className="font-semibold">{initials(user) || '#'}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium hover:underline">{fullName(user)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user.headline || tRoles(user.role)}
          </span>
        </span>
      </Link>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </Card>
  )
}
