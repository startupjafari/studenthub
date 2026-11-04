'use client'

import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Search } from 'lucide-react'
import { campusKeys, searchCampus, type CampusSpaceHit } from '../../../entities/campus'
import { Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib'

const DEBOUNCE_MS = 250

/**
 * Поиск помещения по номеру и названию (сервер, §18): выдача — список под полем, стрелки и
 * Enter работают как в комбобоксе. Используется и как «Найти», и как выбор «Откуда/Куда».
 */
export function SpaceSearch({
  campusId,
  placeholder,
  onPick,
  autoFocus,
}: {
  campusId: string
  placeholder: string
  onPick: (hit: CampusSpaceHit) => void
  autoFocus?: boolean
}) {
  const t = useTranslations('CampusMap')
  const listId = useId()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim().slice(0, 100)), DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [q])
  const results = useQuery({
    queryKey: campusKeys.search(debounced, campusId),
    queryFn: () => searchCampus(debounced, campusId),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  })
  const items = results.data ?? []
  const pick = (hit: CampusSpaceHit): void => {
    onPick(hit)
    setQ('')
    setDebounced('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        size="md"
        className="pr-9 pl-9"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={placeholder}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(items.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault()
            pick(items[active])
          }
        }}
      />
      {results.isFetching && (
        <Loader2
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      {open && debounced && !results.isFetching && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('nothingFound')}</li>
          ) : (
            items.map((hit, i) => (
              <li
                key={hit.spaceId}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(hit)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer rounded-lg px-3 py-2 text-sm',
                  i === active && 'bg-muted',
                )}
              >
                <span className="font-medium tabular-nums">{hit.number ?? hit.name}</span>
                {hit.number && hit.name && (
                  <span className="text-muted-foreground"> · {hit.name}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {[
                    hit.building?.code ?? hit.building?.name,
                    hit.floor ? t('floorN', { label: hit.floor.label }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
