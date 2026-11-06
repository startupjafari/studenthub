'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'
import { Role } from '@studenthub/shared-types'
import { useAppSelector } from '../../../shared/store'
import { adminUserKeys, directoryKeys, fetchUserDirectory, fetchUsers } from '../api/user-api'
import { Avatar, AvatarFallback, AvatarImage, Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib/utils'

export interface PickedUser {
  id: string
  firstName: string
  lastName: string
  /** Для показа выбранного: аватар и подпись, по которой его отличают от однофамильцев. */
  avatarThumbUrl?: string | null
  caption?: string
}

interface UserPickerProps {
  value: PickedUser | null
  onSelect: (user: PickedUser | null) => void
  // Одна роль или несколько: преподавателем пары можно поставить и декана (C-F27).
  roleFilter?: Role | readonly Role[]
  placeholder?: string
  /**
   * Результаты под полем, в потоке, а не всплывающим списком поверх. Нужно внутри окна:
   * всплывающий список упирается в его край и прокручивает окно вместо себя.
   */
  inline?: boolean
}

const ADMIN_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

// Универсальный выбор пользователя. Admin+ ищут через GET /users (там есть фильтр по роли
// и админский scope); остальные — через справочник GET /users/directory: свой вуз целиком,
// а без запроса — круг общения (друзья и одногруппники). Раньше не-админам показывались
// только участники своей группы, и позвать в чат-группу однокурсника с другого потока было
// нельзя, хотя написать ему лично — можно.
export function UserPicker({
  value,
  onSelect,
  roleFilter,
  placeholder,
  inline = false,
}: UserPickerProps) {
  const t = useTranslations('People')
  const tRoles = useTranslations('Roles')
  const viewerRole = useAppSelector((s) => s.auth.role)
  const canAdminSearch = viewerRole !== null && ADMIN_ROLES.includes(viewerRole)

  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Справочник ходит на сервер на каждый терм — дебаунсим, как поиск в чатах.
  useEffect(() => {
    const id = setTimeout(() => setTerm(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const roles: readonly Role[] =
    roleFilter === undefined ? [] : typeof roleFilter === 'string' ? [roleFilter] : roleFilter

  const adminQuery = useQuery({
    queryKey: [...adminUserKeys.list({ search }), 'roles', ...roles],
    // Пикеру нужны только строки — общее число страниц ему ни к чему. GET /users фильтрует по
    // одной роли — на несколько ролей идёт по запросу на каждую.
    queryFn: async () => {
      if (roles.length <= 1) {
        return (await fetchUsers({ search, role: roles[0], limit: 20 })).items
      }
      const pages = await Promise.all(roles.map((role) => fetchUsers({ search, role, limit: 20 })))
      return pages
        .flatMap((p) => p.items)
        .sort(
          (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
        )
    },
    enabled: canAdminSearch && search.trim().length >= 2,
  })

  const directoryQuery = useQuery({
    queryKey: directoryKeys.search(term),
    queryFn: () => fetchUserDirectory(term),
    enabled: !canAdminSearch,
  })

  // Фильтр по роли справочник не принимает (он не про подбор преподавателя, а про людей
  // вокруг) — отсеиваем на клиенте по роли, которая и так есть в каждой карточке.
  // Подпись строки — то, чем отличаются однофамильцы: роль и почта у админского поиска,
  // роль и группа (или факультет) у справочника. Одних ФИО в длинном списке не хватало.
  const results: PickedUser[] = canAdminSearch
    ? (adminQuery.data ?? []).map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarThumbUrl: u.avatarThumbUrl,
        caption: `${tRoles(u.role)} · ${u.email}`,
      }))
    : (directoryQuery.data?.items ?? [])
        .filter((u) => roles.length === 0 || roles.includes(u.role))
        .map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          avatarThumbUrl: u.avatarThumbUrl,
          caption: [tRoles(u.role), u.groupName ?? u.facultyName].filter(Boolean).join(' · '),
        }))

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-input px-3 py-2 text-sm">
        <PersonRow person={value} />
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
        <div
          className={cn(
            'w-full overflow-y-auto rounded-xl border border-border bg-popover p-1',
            inline ? 'mt-2 max-h-72' : 'absolute z-50 mt-1 max-h-60 shadow-lg',
          )}
        >
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
                  onSelect(u)
                  setOpen(false)
                  setSearch('')
                }}
                className="flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <PersonRow person={u} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Человек строкой: аватар, ФИО и подпись (роль и чем отличается от однофамильцев). */
function PersonRow({ person }: { person: PickedUser }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-8 shrink-0">
        {person.avatarThumbUrl && <AvatarImage src={person.avatarThumbUrl} alt="" />}
        <AvatarFallback className="text-xs">
          {`${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          {person.lastName} {person.firstName}
        </span>
        {person.caption && (
          <span className="truncate text-xs text-muted-foreground">{person.caption}</span>
        )}
      </span>
    </span>
  )
}
