'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AsyncSelect, type AsyncSelectItem, type ControlSize } from '../../../shared/ui'
import { fetchUniversities, fetchUniversity, universityKeys } from '../api/university-api'
import type { University } from '../api/university-api'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  size?: ControlSize
  placeholder?: string
  // Узкое место (боковая колонка карьеры): в поле — аббревиатура, полное название — в списке.
  short?: boolean
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в UniversityListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

/**
 * Выбор вуза с серверным поиском по названию и аббревиатуре. Раньше пикеры получали
 * первые 200 вузов одним запросом (предел схемы) и выдавали их за полный список: вуз
 * дальше по алфавиту выбрать было нельзя ни для инвайта, ни для карьерного центра.
 */
export function UniversitySelect({ id, value, onChange, size, placeholder, short }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const params = {
    page: 1,
    limit: LIMIT,
    sort: 'name' as const,
    order: 'asc' as const,
    ...(debounced ? { search: debounced } : {}),
  }
  const { data, isFetching } = useQuery({
    queryKey: universityKeys.list(params),
    queryFn: () => fetchUniversities(params),
    staleTime: 60_000,
  })

  const labelOf = (u: University): string => (short && u.shortName ? u.shortName : u.name)
  const list = data?.items ?? []
  const items: AsyncSelectItem[] = list.map((u) => ({
    value: u.id,
    label: u.name,
    hint: u.shortName,
  }))

  const fromList = list.find((u) => u.id === value)
  const known = (picked?.id === value ? picked?.label : null) ?? (fromList && labelOf(fromList))
  // Выбранного вуза может не быть в текущей выдаче (выбор сохранён, а поиск показывает
  // первые 20 по алфавиту) — подпись тогда резолвится отдельным запросом по id.
  const selected = useQuery({
    queryKey: universityKeys.detail(value ?? ''),
    queryFn: () => fetchUniversity(value as string),
    enabled: !!value && !known,
    staleTime: 5 * 60_000,
  })
  const selectedLabel = known ?? (selected.data ? labelOf(selected.data) : null)

  return (
    <AsyncSelect
      id={id}
      value={value ?? ''}
      onChange={(next) => {
        const u = list.find((i) => i.id === next)
        setPicked(next && u ? { id: next, label: labelOf(u) } : null)
        onChange(next || null)
      }}
      selectedLabel={selectedLabel}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
      size={size}
      placeholder={placeholder}
    />
  )
}
