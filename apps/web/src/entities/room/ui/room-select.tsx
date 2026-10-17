'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AsyncSelect, type AsyncSelectItem, type ControlSize } from '../../../shared/ui'
import { fetchRoomsSorted, roomKeys } from '../api/room-api'

interface Props {
  id?: string
  value: string | null
  onChange: (next: string | null) => void
  // Вуз — для платформенных ролей; у вуз-ролей сервер берёт его из JWT.
  universityId?: string
  // Подпись уже выбранного помещения: его может не оказаться в текущей выдаче поиска.
  initialLabel?: string | null
  size?: ControlSize
}

const DEBOUNCE_MS = 250
const LIMIT = 20
// Предел `search` в RoomListQuerySchema: длиннее сервер отвечает 400.
const SEARCH_MAX = 100

/**
 * Выбор помещения с серверным поиском по названию. Раньше расписание получало первые
 * 100 аудиторий, и пару нельзя было поставить в 101-ю. Корпус второй строкой: номера
 * аудиторий в разных корпусах совпадают.
 */
export function RoomSelect({ id, value, onChange, universityId, initialLabel, size }: Props) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().slice(0, SEARCH_MAX)), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const params = { universityId, search: debounced || undefined, limit: LIMIT }
  const { data, isFetching } = useQuery({
    queryKey: roomKeys.list(params),
    queryFn: () => fetchRoomsSorted(params),
    staleTime: 60_000,
  })

  const items: AsyncSelectItem[] = (data?.items ?? []).map((r) => ({
    value: r.id,
    label: r.name,
    hint: r.building,
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
