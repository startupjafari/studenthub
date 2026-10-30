'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { AsyncSelect, type AsyncSelectItem } from '../../../shared/ui'
import { adminUserKeys, fetchUsers, type AdminUser } from '../../../entities/user'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  /** Нынешний экзаменатор: его может не оказаться в выдаче поиска, подпись — отсюда. */
  initial?: { firstName: string; lastName: string } | null
  placeholder?: string
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в UserListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

const label = (u: { firstName: string; lastName: string }): string => `${u.lastName} ${u.firstName}`

// Экзаменатором сервер разрешает преподавателя или декана того же вуза
// (`assertSameUniversity`), заблокированных отклоняет — список собран так же. Фильтр роли
// в GET /users одиночный, поэтому два запроса; scope смотрящего сервер применяет сам.
async function fetchExaminers(search: string): Promise<AdminUser[]> {
  const params = { search: search || undefined, limit: LIMIT }
  const [teachers, deans] = await Promise.all([
    fetchUsers({ ...params, role: Role.TEACHER }),
    fetchUsers({ ...params, role: Role.DEAN }),
  ])
  return [...teachers.items, ...deans.items]
    .filter((u) => !u.isBlocked)
    .sort((a, b) => label(a).localeCompare(label(b)))
}

/**
 * Выбор экзаменатора с серверным поиском. Пустое значение — «без отдельного экзаменатора»:
 * при назначении сервер ставит ведущего дисциплину.
 */
export function ExaminerSelect({ id, value, onChange, initial, placeholder }: Props) {
  const tRoles = useTranslations('Roles')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<string | null>(initial ? label(initial) : null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const { data, isFetching } = useQuery({
    // Свой ключ под общим префиксом: форма ответа другая, чем у таблицы пользователей.
    queryKey: [...adminUserKeys.all, 'examiners', debounced],
    queryFn: () => fetchExaminers(debounced),
    staleTime: 60_000,
  })

  // Вторая строка — почта (различает однофамильцев), у декана перед ней роль.
  const items: AsyncSelectItem[] = (data ?? []).map((u) => ({
    value: u.id,
    label: label(u),
    hint: u.role === Role.DEAN ? `${tRoles('DEAN')} · ${u.email}` : u.email,
  }))

  return (
    <AsyncSelect
      id={id}
      value={value ?? ''}
      onChange={(next) => {
        setPicked(items.find((i) => i.value === next)?.label ?? null)
        onChange(next || null)
      }}
      selectedLabel={picked}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
      placeholder={placeholder}
    />
  )
}
