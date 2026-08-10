'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '../../../shared/ui'
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
    <Card className="flex items-center gap-3 p-3">
      <Link href={`/profile/${user.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {user.avatarUrl ? (
          <Image
            src={user.avatarThumbUrl ?? user.avatarUrl}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="size-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initials(user) || '#'}
          </span>
        )}
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
