'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Search } from 'lucide-react'
import { campusKeys, searchCampus, type CampusSpaceHit } from '../../../entities/campus'
import { Input } from '../../../shared/ui'
import { cn } from '../../../shared/lib'

const DEBOUNCE_MS = 250

/** Готовый вариант до ввода: вход территории, выбранное на карте помещение. */
export interface SearchSuggestion {
  key: string
  label: string
  icon?: ReactNode
  onPick: () => void
}

/**
 * Поиск помещения по номеру и названию (сервер, §18): выдача — список под полем, стрелки и
 * Enter работают как в комбобоксе. Используется и как «Найти», и как выбор «Откуда/Куда».
 * `suggestions` — варианты в том же списке, пока поле в фокусе и ничего не введено.
 */
export function SpaceSearch({
  campusId,
  placeholder,
  onPick,
  autoFocus,
  suggestions = [],
}: {
  campusId: string
  placeholder: string
  onPick: (hit: CampusSpaceHit) => void
  autoFocus?: boolean
  suggestions?: SearchSuggestion[]
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
  const suggesting = !q.trim() && suggestions.length > 0
  const count = suggesting ? suggestions.length : items.length
  const pick = (hit: CampusSpaceHit): void => {
    onPick(hit)
    setQ('')
    setDebounced('')
    setOpen(false)
  }
  const pickSuggestion = (s: SearchSuggestion): void => {
    s.onPick()
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
        aria-expanded={open && count > 0}
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
        onFocus={() => {
          setActive(0)
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(count - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter') {
            const s = suggesting ? suggestions[active] : undefined
            const hit = suggesting ? undefined : items[active]
            if (s || hit) e.preventDefault()
            if (s) pickSuggestion(s)
            else if (hit) pick(hit)
          } else if (e.key === 'Escape' && open) {
            // Сначала закрыть список; страницу Esc не уводит (useEscapeBack).
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {results.isFetching && (
        <Loader2
          className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      {open && suggesting && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pickSuggestion(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm',
                i === active && 'bg-muted',
              )}
            >
              {s.icon && (
                <span className="shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden>
                  {s.icon}
                </span>
              )}
              <span className="truncate">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !suggesting && debounced && !results.isFetching && (
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
