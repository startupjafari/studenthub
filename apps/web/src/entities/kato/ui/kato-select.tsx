'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import type { KatoScopeValue } from '@studenthub/shared-schemas'
import { AsyncSelect, type ControlSize } from '../../../shared/ui'
import { katoKeys, searchKato } from '../api/kato-api'
import { katoName, katoRegionName } from '../lib/kato-name'
import { isKatoCode, useKatoNames } from '../lib/use-kato-names'

interface KatoSelectProps {
  value: string
  onChange: (next: string) => void
  scope?: KatoScopeValue
  // Разрешить произвольный текст: у зарубежного вуза города в КАТО нет.
  allowCustom?: boolean
  size?: ControlSize
  id?: string
}

const DEBOUNCE_MS = 250

/**
 * Выбор населённого пункта из КАТО. Хранит и отдаёт **код** справочника (9 цифр),
 * а при `allowCustom` — произвольную строку для зарубежных адресов.
 */
export function KatoSelect({
  value,
  onChange,
  scope = 'places',
  allowCustom = true,
  size,
  id,
}: KatoSelectProps) {
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const { data, isFetching } = useQuery({
    queryKey: katoKeys.search(debounced, scope),
    queryFn: () => searchKato(debounced, scope),
    // Пустой запрос тоже осмыслен: показывает первые записи, чтобы список не был
    // пустым до первого ввода.
    staleTime: Infinity,
  })

  // Выбранного кода может не быть в текущей выдаче — подпись резолвится отдельно.
  const { nameOf } = useKatoNames([isKatoCode(value) ? value : null])

  const items = (data ?? []).map((u) => ({
    value: u.code,
    label: katoName(u, locale),
    hint: katoRegionName(u, locale),
  }))

  return (
    <AsyncSelect
      id={id}
      value={value}
      onChange={onChange}
      selectedLabel={isKatoCode(value) ? nameOf(value) : value}
      items={items}
      query={query}
      onQueryChange={setQuery}
      loading={isFetching}
      allowCustom={allowCustom}
      size={size}
    />
  )
}
