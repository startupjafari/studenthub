'use client'

import { useState, type FocusEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Accessibility, ArrowDownUp, DoorOpen, MapPin, X } from 'lucide-react'
import type { CampusSpaceHit } from '../../../entities/campus'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib'
import type { Place } from '../lib/places'
import { SpaceSearch } from './space-search'

type End = 'from' | 'to'

/** Быстрый выбор под активным полем: ворота территории, помещение, выбранное на карте. */
export interface RouteSuggestion {
  place: Place
  kind: 'gate' | 'selected'
}

/**
 * «Откуда / Куда» в духе 2ГИС: два поля друг под другом с метками А и Б, соединёнными
 * пунктиром, справа между ними — «поменять местами». Быстрые варианты показываются только
 * под полем в фокусе и только пока оно пустое, а не висят всегда. «Без лестниц» — чип-переключатель.
 */
export function RouteForm({
  campusId,
  from,
  to,
  onPick,
  onClear,
  onSwap,
  stepFree,
  onStepFree,
  suggestions,
}: {
  campusId: string
  from: Place | null
  to: Place | null
  onPick: (end: End, value: CampusSpaceHit | Place) => void
  onClear: (end: End) => void
  onSwap: () => void
  stepFree: boolean
  onStepFree: (v: boolean) => void
  suggestions: RouteSuggestion[]
}) {
  const t = useTranslations('CampusMap')
  const [active, setActive] = useState<End | null>(null)
  // Первое пустое поле — сразу в фокус, но только с мышью: на телефоне вылезла бы клавиатура
  // поверх карты, которую человек ещё не успел рассмотреть.
  const [autoFocusEnd] = useState<End | null>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches
      ? !from
        ? 'from'
        : !to
          ? 'to'
          : null
      : null,
  )

  const row = (end: End, value: Place | null, other: Place | null): ReactNode => {
    const label = end === 'from' ? t('from') : t('to')
    const chips = suggestions.filter(
      (s) => s.place.spaceId !== other?.spaceId && s.place.spaceId !== value?.spaceId,
    )
    return (
      <div
        className="relative flex flex-col gap-2"
        onFocus={() => setActive(end)}
        onBlur={(e: FocusEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(null)
        }}
      >
        {/* Пунктир от А вниз до Б: идёт по оси меток и тянется вместе с чипами под «Откуда». */}
        {end === 'from' && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-7 -bottom-4 left-[0.5625rem] border-l-2 border-dotted border-muted-foreground/40"
          />
        )}
        <div className="flex items-center gap-2">
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
                autoFocus={autoFocusEnd === end}
                onPick={(hit) => onPick(end, hit)}
              />
            )}
          </div>
        </div>
        {active === end && !value && chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pl-7">
            {chips.map((s) => (
              <Button
                key={s.place.spaceId}
                type="button"
                size="sm"
                variant="secondary"
                // Фокус остаётся в поле: без этого Safari снимает его до клика и чип исчезает.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(end, s.place)}
              >
                {s.kind === 'gate' ? <DoorOpen aria-hidden /> : <MapPin aria-hidden />}
                {s.place.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
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
      <div className="pl-7">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-pressed={stepFree}
          onClick={() => onStepFree(!stepFree)}
          className={cn(
            stepFree && 'bg-primary/10 text-primary ring-1 ring-primary/30 hover:bg-primary/15',
          )}
        >
          <Accessibility aria-hidden />
          {t('stepFree')}
        </Button>
      </div>
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
