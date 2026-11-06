'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Role } from '@studenthub/shared-types'
import { AsyncSelect, type AsyncSelectItem } from '../../../shared/ui'
import { adminUserKeys, fetchUsers, type AdminUser } from '../../../entities/user'
import type { CourseTeacherRef } from '../../../entities/course'
import { teacherLabel } from '../lib/course-patch'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  // Нынешний преподаватель курса: его может не оказаться в выдаче поиска, подпись — отсюда.
  initial?: CourseTeacherRef | null
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в UserListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

// Вести дисциплину сервер разрешает преподавателю или декану того же вуза
// (`assertTeacherSameUniversity`), заблокированных отклоняет — список собран так же.
// Фильтр роли в GET /users одиночный, поэтому два запроса; scope смотрящего (декан —
// свой факультет, админ — вуз) сервер применяет сам.
async function fetchCourseTeachers(search: string): Promise<AdminUser[]> {
  const params = { search: search || undefined, limit: LIMIT }
  const [teachers, deans] = await Promise.all([
    fetchUsers({ ...params, role: Role.TEACHER }),
    fetchUsers({ ...params, role: Role.DEAN }),
  ])
  return [...teachers.items, ...deans.items]
    .filter((u) => !u.isBlocked)
    .sort((a, b) => teacherLabel(a).localeCompare(teacherLabel(b)))
}

// Выбор преподавателя дисциплины с серверным поиском. Пустое значение — «без преподавателя».
export function TeacherSelect({ id, value, onChange, initial }: Props) {
  const tRoles = useTranslations('Roles')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [label, setLabel] = useState<string | null>(initial ? teacherLabel(initial) : null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const { data, isFetching } = useQuery({
    // Свой ключ под общим префиксом: форма ответа другая, чем у таблицы пользователей.
    queryKey: [...adminUserKeys.all, 'course-teachers', debounced],
    queryFn: () => fetchCourseTeachers(debounced),
    staleTime: 60_000,
  })

  // Вторая строка — почта (различает однофамильцев), у декана перед ней роль.
  const items: AsyncSelectItem[] = (data ?? []).map((u) => ({
    value: u.id,
    label: teacherLabel(u),
    hint: u.role === Role.DEAN ? `${tRoles('DEAN')} · ${u.email}` : u.email,
  }))

  return (
    <AsyncSelect
      id={id}
      value={value ?? ''}
      onChange={(next) => {
        setLabel(items.find((i) => i.value === next)?.label ?? null)
        onChange(next || null)
      }}
      selectedLabel={label}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
    />
  )
}
