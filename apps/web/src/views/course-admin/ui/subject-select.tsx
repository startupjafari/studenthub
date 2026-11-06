'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AsyncSelect, type AsyncSelectItem } from '../../../shared/ui'
import { courseKeys, fetchSubjectsPaged } from '../../../entities/course'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в SubjectListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 200

// Выбор дисциплины из справочника вуза с серверным поиском по названию. Раньше модалка
// получала строки текущей страницы вкладки «Справочник» — 20 первых по алфавиту, и
// дисциплину из конца алфавита нельзя было назначить, не перелистав скрытую вкладку.
export function SubjectSelect({ id, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const params = { search: debounced || undefined, limit: LIMIT }
  const { data, isFetching } = useQuery({
    queryKey: courseKeys.subjects(params),
    queryFn: () => fetchSubjectsPaged(params),
    staleTime: 60_000,
  })

  // Код второй строкой: различает одноимённые дисциплины.
  const items: AsyncSelectItem[] = (data?.items ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.code,
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
