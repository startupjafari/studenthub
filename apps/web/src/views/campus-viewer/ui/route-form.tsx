'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDownUp, DoorOpen, MapPin, X } from 'lucide-react'
import type { CampusSpaceHit } from '../../../entities/campus'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import type { Place } from '../lib/places'
import { SpaceSearch } from './space-search'

type End = 'from' | 'to'

/** Быстрый выбор в списке поля: ворота территории, помещение, выбранное на карте. */
export interface RouteSuggestion {
  place: Place
  kind: 'gate' | 'selected'
}

/**
 * «Откуда / Куда» в духе 2ГИС: два поля друг под другом с метками А и Б, соединёнными
 * пунктиром, справа между ними — «поменять местами». Быстрые варианты (входы, выбранное на
 * карте) — в выпадающем списке поля, пока оно в фокусе и пустое: раскладку они не двигают.
 */
export function RouteForm({
  campusId,
  from,
  to,
  onPick,
  onClear,
  onSwap,
  suggestions,
}: {
  campusId: string
  from: Place | null
  to: Place | null
  onPick: (end: End, value: CampusSpaceHit | Place) => void
  onClear: (end: End) => void
  onSwap: () => void
  suggestions: RouteSuggestion[]
}) {
  const t = useTranslations('CampusMap')

  const row = (end: End, value: Place | null, other: Place | null): ReactNode => {
    const label = end === 'from' ? t('from') : t('to')
    const options = suggestions
      .filter((s) => s.place.spaceId !== other?.spaceId)
      .map((s) => ({
        key: s.place.spaceId,
        label: s.place.label,
        icon: s.kind === 'gate' ? <DoorOpen /> : <MapPin />,
        onPick: () => onPick(end, s.place),
      }))
    return (
      <div className="relative flex items-center gap-2">
        {/* Пунктир от А вниз до Б — по оси меток. */}
        {end === 'from' && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-7 -bottom-4 left-[0.5625rem] border-l-2 border-dotted border-muted-foreground/40"
          />
        )}
        <Marker end={end} />
        <div className="min-w-0 flex-1">
          {value ? (
            <div className="flex h-9 items-center justify-between gap-2 rounded-xl bg-muted px-3 text-sm">
              <span className="truncate font-medium" aria-label={`${label}: ${value.label}`}>
                {value.label}
              </span>
              <button
                type="button"
                onClick={() => onClear(end)}
                aria-label={t('clear')}
                className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <SpaceSearch
              campusId={campusId}
              placeholder={label}
              suggestions={options}
              onPick={(hit) => onPick(end, hit)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {row('from', from, to)}
        {row('to', to, from)}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon
        aria-label={t('swap')}
        title={t('swap')}
        onClick={onSwap}
        disabled={!from && !to}
      >
        <ArrowDownUp aria-hidden />
      </Button>
    </div>
  )
}

function Marker({ end }: { end: End }) {
  const t = useTranslations('CampusMap')
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold text-white ring-2 ring-card',
        end === 'from' ? 'bg-success' : 'bg-destructive',
      )}
    >
      {end === 'from' ? t('markerFrom') : t('markerTo')}
    </span>
  )
}
