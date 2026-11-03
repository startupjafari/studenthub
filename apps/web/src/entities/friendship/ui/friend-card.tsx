'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from '../../../shared/ui'
import type { FriendUser } from '../api/friendship-api'

function fullName(u: FriendUser): string {
  return [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ')
}

function initials(u: FriendUser): string {
  return ((u.lastName[0] ?? '') + (u.firstName[0] ?? '')).toUpperCase()
}

/**
 * Строка человека в списках друзей и заявок: аватар, имя, подпись и слот действий справа.
 *
 * Строкой списка, а не карточкой: в окне это один столбец, и рамка вокруг каждой строки
 * дробила его на кирпичи. Подсветка при наведении — на всю строку, как в списке чатов.
 * Имя и подпись сокращаются многоточием и не выталкивают действия; полное имя — в подсказке.
 *
 * `meta` — дополнение к подписи (например «ожидает ответа» у исходящей заявки): встаёт
 * после роли той же приглушённой строкой.
 */
export function FriendCard({
  user,
  meta,
  action,
}: {
  user: FriendUser
  meta?: ReactNode
  action?: ReactNode
}) {
  const tRoles = useTranslations('Roles')
  const name = fullName(user)
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-muted/60">
      <Link
        href={`/profile/${user.id}`}
        title={name}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* Avatar из системы, а не голый <Image>: он сам показывает заглушку и когда
            ссылки нет, и когда картинка НЕ ЗАГРУЗИЛАСЬ (протухшая ссылка, недоступный
            MinIO). У <Image> второй случай давал иконку «битая картинка» — техническую
            поломку в списке людей. */}
        <Avatar className="size-11 shrink-0">
          <AvatarImage src={user.avatarThumbUrl ?? user.avatarUrl ?? undefined} alt="" />
          <AvatarFallback className="font-semibold">{initials(user) || '#'}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{user.headline || tRoles(user.role)}</span>
            {meta}
          </span>
        </span>
      </Link>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  )
}
