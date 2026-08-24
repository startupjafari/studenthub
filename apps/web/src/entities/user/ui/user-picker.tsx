'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { adminUserKeys, fetchUsers } from '../api/user-api'
import { fetchGroupMembers, groupKeys } from '../../group'
import { Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

export interface PickedUser {
  id: string
  firstName: string
  lastName: string
}

interface UserPickerProps {
  value: PickedUser | null
  onSelect: (user: PickedUser | null) => void
  roleFilter?: Role
  placeholder?: string
}

const ADMIN_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

// Универсальный выбор пользователя. Admin+ ищут через GET /users; остальные — по участникам
// своей группы (GET /groups/:id/members), т.к. GET /users им недоступен.
export function UserPicker({ value, onSelect, roleFilter, placeholder }: UserPickerProps) {
  const t = useTranslations('People')
  const viewerRole = useAppSelector((s) => s.auth.role)
  const myGroupId = useAppSelector((s) => s.auth.groupId)
  const canAdminSearch = viewerRole !== null && ADMIN_ROLES.includes(viewerRole)

  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const adminQuery = useQuery({
    queryKey: adminUserKeys.list({ search, role: roleFilter }),
    // Пикеру нужны только строки — общее число страниц ему ни к чему.
    queryFn: async () => (await fetchUsers({ search, role: roleFilter, limit: 20 })).items,
    enabled: canAdminSearch && search.trim().length >= 2,
  })

  const groupQuery = useQuery({
    queryKey: groupKeys.members(myGroupId ?? ''),
    queryFn: () => fetchGroupMembers(myGroupId as string),
    enabled: !canAdminSearch && !!myGroupId,
  })

  const results: PickedUser[] = canAdminSearch
    ? (adminQuery.data ?? [])
    : (groupQuery.data ?? [])
        .filter((m) => !roleFilter || m.role === roleFilter)
        .filter((m) =>
          search.trim().length === 0
            ? true
            : `${m.lastName} ${m.firstName}`.toLowerCase().includes(search.toLowerCase()),
        )

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-input px-3 py-2 text-sm">
        <span>
          {value.lastName} {value.firstName}
        </span>
        <button
          type="button"
          aria-label={t('clear')}
          onClick={() => onSelect(null)}
          className="cursor-pointer text-muted-foreground hover:text-destructive"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search
          className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? t('pickUser')}
          className="pl-9"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-background shadow-sm">
          {canAdminSearch && search.trim().length < 2 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('typeToSearch')}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('noneFound')}</p>
          ) : (
            results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onSelect({ id: u.id, firstName: u.firstName, lastName: u.lastName })
                  setOpen(false)
                  setSearch('')
                }}
                className={cn(
                  'block w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                )}
              >
                {u.lastName} {u.firstName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
