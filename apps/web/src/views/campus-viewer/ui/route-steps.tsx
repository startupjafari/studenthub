'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Footprints,
  Loader2,
  LogIn,
  LogOut,
  Play,
  Square,
} from 'lucide-react'
import type { RouteStep } from '@studenthub/campus-core'
import { Button } from '../../../shared/ui'
import { cn } from '../../../shared/lib'

/** Скорость пешехода для оценки времени (§15.5) — допущение пишем рядом с цифрой. */
const WALK_MM_PER_MIN = 72_000

/** Шаг для списка: «вошёл и сразу вышел» из одного корпуса склеен в «пройдите через». */
type ListStep = RouteStep | { type: 'pass'; floor: string | null }

function merge(steps: RouteStep[], buildingOf: (floorId: string | null) => string): ListStep[] {
  const out: ListStep[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    const next = steps[i + 1]
    if (
      s.type === 'enter' &&
      next?.type === 'exit' &&
      buildingOf(s.toFloor) === buildingOf(next.fromFloor)
    ) {
      out.push({ type: 'pass', floor: s.toFloor })
      i++
      continue
    }
    out.push(s)
  }
  return out
}

function floorOf(s: ListStep): string | null {
  switch (s.type) {
    case 'vertical':
    case 'enter':
      return s.toFloor
    case 'exit':
      return s.fromFloor
    case 'pass':
      return s.floor
    default:
      return null
  }
}

/**
 * Готовый маршрут: сверху — сколько идти (время крупно, метры и число корпусов рядом) и
 * «пройти маршрут» камерой; ниже — шаги лентой с метками А и Б по краям. Шаг с этажом
 * кликабелен — карта переключается на этот этаж; шаги текущего этажа подсвечены.
 */
export function RouteSummary({
  steps,
  currentFloor,
  floorLabel,
  placeLabel,
  buildingOf,
  onStep,
  touring,
  onTour,
}: {
  steps: RouteStep[]
  currentFloor: string | null
  floorLabel: (floorId: string | null) => string
  placeLabel: (spaceId: string | null) => string
  buildingOf: (floorId: string | null) => string
  onStep: (floorId: string | null, spaceId: string | null) => void
  touring: boolean
  onTour: () => void
}) {
  const t = useTranslations('CampusMap')
  const list = merge(steps, buildingOf)
  const arrive = steps.find((s) => s.type === 'arrive')
  const distanceMm = arrive?.type === 'arrive' ? arrive.distanceMm : 0
  const buildings = new Set(
    list.flatMap((s) => {
      const f = floorOf(s)
      return f ? [buildingOf(f)] : []
    }),
  ).size

  const text = (s: ListStep): string => {
    switch (s.type) {
      case 'start':
        return s.spaceId?.startsWith('gate:')
          ? t('stepStartGate', { place: placeLabel(s.spaceId) })
          : t('stepStart', { place: placeLabel(s.spaceId) })
      case 'vertical':
        return t(`stepVertical_${s.via}`, {
          up: s.up ? 'up' : 'down',
          floor: floorLabel(s.toFloor),
        })
      case 'exit':
        return t('stepExit', { building: buildingOf(s.fromFloor) })
      case 'enter':
        return t('stepEnter', { building: buildingOf(s.toFloor), floor: floorLabel(s.toFloor) })
      case 'pass':
        return t('stepPass', { building: buildingOf(s.floor) })
      case 'arrive':
        return t('stepArriveHere', { place: placeLabel(s.spaceId) })
    }
  }
  const icon = (s: ListStep): ComponentType<{ className?: string }> | null => {
    switch (s.type) {
      case 'vertical':
        return s.up ? ArrowUp : ArrowDown
      case 'enter':
        return LogIn
      case 'exit':
        return LogOut
      case 'pass':
        return Footprints
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3">
        <div className="min-w-0">
          <p className="text-lg leading-tight font-semibold tabular-nums">
            {t('routeMinutes', { minutes: Math.max(1, Math.round(distanceMm / WALK_MM_PER_MIN)) })}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {[
              t('routeMeters', { meters: Math.round(distanceMm / 1000) }),
              buildings > 0 ? t('routeBuildings', { count: buildings }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={touring ? 'secondary' : 'default'}
          aria-pressed={touring}
          onClick={onTour}
        >
          {touring ? <Square aria-hidden /> : <Play aria-hidden />}
          {touring ? t('tourStop') : t('tourStart')}
        </Button>
      </div>

      <ol className="relative flex flex-col">
        {/* Лента шагов: линия по оси значков, от А до Б. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-4 bottom-4 left-[1.125rem] border-l-2 border-dotted border-muted-foreground/30"
        />
        {list.map((s, i) => {
          const floor = floorOf(s)
          const space = s.type === 'start' || s.type === 'arrive' ? s.spaceId : null
          const Icon = icon(s)
          const here = !!floor && floor === currentFloor
          return (
            <li key={i}>
              <button
                type="button"
                disabled={!floor && !space}
                onClick={() => onStep(floor, space)}
                className={cn(
                  'relative flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm enabled:hover:bg-muted',
                  'focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-inset',
                  here && 'bg-primary/5',
                )}
              >
                <span
                  className={cn(
                    'relative z-[1] mt-px flex size-5 shrink-0 items-center justify-center rounded-full ring-2 ring-card',
                    s.type === 'start'
                      ? 'bg-success text-[0.625rem] font-bold text-white'
                      : s.type === 'arrive'
                        ? 'bg-destructive text-[0.625rem] font-bold text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {s.type === 'start'
                    ? t('markerFrom')
                    : s.type === 'arrive'
                      ? t('markerTo')
                      : Icon && <Icon className="size-3" />}
                </span>
                <span className={cn('min-w-0', s.type === 'arrive' && 'font-medium')}>
                  {text(s)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="px-2 text-xs text-muted-foreground">{t('timeAssumption')}</p>
    </div>
  )
}

/**
 * Что сейчас с маршрутом, одной строкой: точки совпали, строим, почему не вышло. Пока
 * точки не заданы — ничего: поля «Откуда/Куда» говорят сами за себя.
 */
export function RouteStatus({
  from,
  to,
  loading,
  hasRoute,
  reason,
}: {
  from: { spaceId: string } | null
  to: { spaceId: string } | null
  loading: boolean
  hasRoute: boolean
  reason: string | null
}) {
  const t = useTranslations('CampusMap')
  if (!from || !to) return null
  if (from.spaceId === to.spaceId) {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t('routeSame')}
      </p>
    )
  }
  if (loading && !hasRoute) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('routeLoading')}
      </p>
    )
  }
  if (reason) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-xl bg-destructive/5 p-3 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(`noRoute_${reason}`)}
      </p>
    )
  }
  return null
}
