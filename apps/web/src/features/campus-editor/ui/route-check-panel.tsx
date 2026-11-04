'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Route } from 'lucide-react'
import {
  buildNavGraph,
  explainNoRoute,
  indexGraph,
  nodePoint,
  routeBetweenSpaces,
  type NavIndex,
} from '@studenthub/campus-core'
import { Button } from '../../../shared/ui'
import { useEditor, type EditorStore } from '../model/store'
import { ChoiceField } from './fields'

const IDENTITY = { x: 0, y: 0, rotationDeg: 0 }

/** Узлы, из которых этаж связан с остальным кампусом: входы и площадки лестниц и лифтов. */
function anchors(index: NavIndex): number[] {
  const out: number[] = []
  for (let i = 0; i < index.adj.length; i++) {
    const kind = nodePoint(index.graph, i).kind
    if (kind === 'entrance' || kind === 'landing') out.push(i)
  }
  return out
}

/** Узлы, достижимые из множества стартов (без учёта профиля). */
function reach(index: NavIndex, starts: number[]): Set<number> {
  const seen = new Set(starts)
  const stack = [...starts]
  while (stack.length) {
    const u = stack.pop()!
    const list = index.adj[u]!
    for (let k = 0; k < list.length; k += 3) {
      const v = list[k]!
      if (!seen.has(v)) {
        seen.add(v)
        stack.push(v)
      }
    }
  }
  return seen
}

/**
 * «Проверка маршрутов» (§15.3): граф этажа строится той же функцией, что при публикации.
 * Отчёт — помещения, до которых не дойти от входа, лестницы или лифта; и пробный маршрут
 * между двумя помещениями прямо на плане.
 */
export function RouteCheckPanel({ store }: { store: EditorStore }) {
  const t = useTranslations('CampusEditor')
  const tm = useTranslations('CampusMap')
  const doc = useEditor(store, (s) => s.doc)
  const [checked, setChecked] = useState<typeof doc | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [reason, setReason] = useState<string | null>(null)

  // План правят дальше — пробная линия маршрута больше не про него.
  useEffect(() => {
    if (checked && doc !== checked && store.getState().route.length > 0) store.set({ route: [] })
  }, [doc, checked, store])

  const index = useMemo(
    () =>
      checked
        ? indexGraph(
            buildNavGraph([
              { floorId: 'f', buildingId: 'b', elevationMm: 0, doc: checked, transform: IDENTITY },
            ]),
          )
        : null,
    [checked],
  )
  const unreachable = useMemo(() => {
    if (!index) return []
    let starts = anchors(index)
    // Ни входа, ни лестницы — опорой считаем самую большую связную часть этажа.
    if (starts.length === 0) {
      let best = new Set<number>()
      const seen = new Set<number>()
      for (let i = 0; i < index.adj.length; i++) {
        if (seen.has(i)) continue
        const comp = reach(index, [i])
        for (const v of comp) seen.add(v)
        if (comp.size > best.size) best = comp
      }
      starts = [...best]
    }
    const ok = reach(index, starts)
    return [...index.nodeBySpace.entries()]
      .filter(([, node]) => !ok.has(node))
      .map(([space]) => space)
  }, [index])

  const spaces = Object.entries(doc.spaces)
    .map(([id, s]) => ({ value: id, label: s.number || s.name || t(`kind_${s.kind}`) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))

  const tryRoute = (): void => {
    if (!index || !from || !to) return
    const route = routeBetweenSpaces(index, from, to)
    store.set({ route: route ? [route.nodes.map((n) => nodePoint(index.graph, n))] : [] })
    setReason(route ? null : explainNoRoute(index, from, to))
  }
  const stale = checked !== null && checked !== doc

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Route className="size-4 text-muted-foreground" aria-hidden />
        {t('routeCheck')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('routeCheckHint')}</p>
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => {
          setChecked(store.getState().doc)
          setReason(null)
          store.set({ route: [] })
        }}
      >
        {checked ? t('routeCheckAgain') : t('routeCheckRun')}
      </Button>
      {stale && <p className="text-xs text-warning">{t('routeCheckStale')}</p>}
      {index && (
        <>
          {unreachable.length === 0 ? (
            <p className="text-sm text-success">{t('allReachable')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-destructive">
                {t('unreachable', { count: unreachable.length })}
              </p>
              <ul className="flex flex-wrap gap-1">
                {unreachable.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/20"
                      onClick={() => store.set({ selection: { kind: 'space', id } })}
                    >
                      {spaces.find((s) => s.value === id)?.label ?? id}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ChoiceField label={tm('from')} value={from} options={spaces} onChange={setFrom} />
          <ChoiceField label={tm('to')} value={to} options={spaces} onChange={setTo} />
          <Button type="button" size="md" disabled={!from || !to || from === to} onClick={tryRoute}>
            {t('tryRoute')}
          </Button>
          {reason && <p className="text-sm text-destructive">{tm(`noRoute_${reason}`)}</p>}
        </>
      )}
    </section>
  )
}
