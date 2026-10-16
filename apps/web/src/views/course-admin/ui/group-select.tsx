'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AsyncSelect, type AsyncSelectItem } from '../../../shared/ui'
import { fetchAllGroups, groupKeys } from '../../../entities/group'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
}

// Выбор группы с поиском по названию. Поиска по группам у GET /groups нет (только фильтр
// факультета), поэтому список собирается целиком и фильтруется здесь. Раньше в модалку
// уходили первые 100 групп — в большом вузе остальные назначить было нельзя.
export function GroupSelect({ id, value, onChange }: Props) {
  const [query, setQuery] = useState('')

  const { data, isFetching } = useQuery({
    queryKey: groupKeys.listAll(),
    queryFn: () => fetchAllGroups(),
    staleTime: 60_000,
  })

  const items = useMemo<AsyncSelectItem[]>(() => {
    const q = query.trim().toLocaleLowerCase()
    return (data ?? [])
      .filter((g) => !q || g.name.toLocaleLowerCase().includes(q))
      .map((g) => ({ value: g.id, label: g.name }))
  }, [data, query])

  return (
    <AsyncSelect
      id={id}
      value={value ?? ''}
      onChange={(next) => onChange(next || null)}
      selectedLabel={data?.find((g) => g.id === value)?.name ?? null}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
    />
  )
}
