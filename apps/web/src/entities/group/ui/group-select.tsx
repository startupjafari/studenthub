'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AsyncSelect, type AsyncSelectItem, type ControlSize } from '../../../shared/ui'
import { fetchGroupsPaged, groupKeys } from '../api/group-api'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  // Ограничить выдачу факультетом. Scope смотрящего (декан — свой факультет) сервер
  // применяет сам, параметр только сужает.
  facultyId?: string
  // Подпись уже выбранной группы: её может не оказаться в текущей выдаче поиска.
  initialLabel?: string | null
  size?: ControlSize
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в GroupListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

/**
 * Выбор группы с серверным поиском по названию. Раньше пикеры получали первые 100 групп
 * по алфавиту, и в большом вузе (400+ групп) хвост алфавита выбрать было нельзя: ни
 * выписать инвайт, ни завести курс или расписание.
 */
export function GroupSelect({ id, value, onChange, facultyId, initialLabel, size }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const params = { facultyId, search: debounced || undefined, limit: LIMIT }
  const { data, isFetching } = useQuery({
    queryKey: groupKeys.page(params),
    queryFn: () => fetchGroupsPaged(params),
    staleTime: 60_000,
  })

  const items: AsyncSelectItem[] = (data?.items ?? []).map((g) => ({
    value: g.id,
    label: g.name,
  }))

  // Подпись — от последнего выбора, если значение снаружи не сменилось на другое.
  const selectedLabel =
    (picked?.id === value ? picked.label : null) ??
    items.find((i) => i.value === value)?.label ??
    initialLabel ??
    null

  return (
    <AsyncSelect
      id={id}
      value={value ?? ''}
      onChange={(next) => {
        const label = items.find((i) => i.value === next)?.label
        setPicked(next && label ? { id: next, label } : null)
        onChange(next || null)
      }}
      selectedLabel={selectedLabel}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
      size={size}
    />
  )
}
