'use client'

import { useState } from 'react'
import { AsyncSelect, type AsyncSelectItem } from '../../../shared/ui'

// Пояс по умолчанию — тот же, что у колонки `University.timezone` в схеме.
export const DEFAULT_UNIVERSITY_TIMEZONE = 'Asia/Almaty'

// Список IANA-зон берём из рантайма (ICU), а не держим свой: он обновляется вместе с
// браузером. Старый браузер без `supportedValuesOf` получает хотя бы пояс по умолчанию.
function listZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [DEFAULT_UNIVERSITY_TIMEZONE]
  }
}
const ZONES = listZones()

interface Props {
  id?: string
  value: string
  onChange: (next: string) => void
}

/**
 * Часовой пояс вуза: по нему считаются день журнала, сводки и «Сегодня». Выбор из списка с
 * поиском, а не свободный ввод — опечатка в названии зоны молча сдвинула бы всё расписание.
 */
export function TimezoneSelect({ id, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const items: AsyncSelectItem[] = (
    q ? ZONES.filter((z) => z.toLowerCase().includes(q)) : ZONES
  ).map((z) => ({ value: z, label: z }))
  return (
    <AsyncSelect
      id={id}
      value={value}
      // Очистка поля пояс не снимает: без пояса вуза не бывает.
      onChange={(next) => {
        if (next) onChange(next)
      }}
      items={items}
      query={query}
      onQueryChange={setQuery}
    />
  )
}
