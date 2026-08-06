'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { cn } from '../../../shared/lib/utils'
import { fetchMe, userKeys } from '../api/user-api'

interface ProfileLinkProps {
  userId: string
  className?: string
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  title?: string
}

// Ссылка на публичный профиль пользователя (/profile/:id). Для самого себя ведёт
// на собственный /profile (редактируемый), а не на read-only публичную версию.
// Читает текущего пользователя из кэша React Query (userKeys.me) — без лишних запросов.
export function ProfileLink({ userId, className, children, onClick, title }: ProfileLinkProps) {
  const me = useQuery({ queryKey: userKeys.me(), queryFn: fetchMe })
  const href = me.data?.id === userId ? '/profile' : `/profile/${userId}`
  return (
    <Link
      href={href}
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-sm outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/40',
        className,
      )}
    >
      {children}
    </Link>
  )
}
