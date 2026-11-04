'use client'

import { useTranslations } from 'next-intl'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { Problem } from '@studenthub/campus-core'
import { cn } from '../../../shared/lib'
import { problemPoint } from '../lib/draw'
import { useEditor, type EditorStore, type Selection } from '../model/store'

/** Выделение по пути проблемы: `walls.<id>` → стена и т. п. */
function selectionFor(problem: Problem): Selection {
  const [kind, id] = problem.path.split('.')
  if (!id) return { kind: 'none' }
  const map: Record<string, Selection['kind']> = {
    nodes: 'node',
    walls: 'wall',
    openings: 'opening',
    spaces: 'space',
    verticals: 'vertical',
    labels: 'label',
  }
  const k = map[kind ?? '']
  return k && k !== 'none' ? ({ kind: k, id } as Selection) : { kind: 'none' }
}

/**
 * Проверка этажа (§11.6): ошибки блокируют публикацию, предупреждения — подсказка. Клик по
 * строке выделяет объект и показывает его на плане.
 */
export function ProblemsPanel({
  store,
  viewport,
}: {
  store: EditorStore
  viewport: () => { width: number; height: number }
}) {
  const t = useTranslations('Campus')
  const te = useTranslations('CampusEditor')
  const problems = useEditor(store, (s) => s.problems)
  const errors = problems.filter((p) => p.severity === 'error').length

  if (problems.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <CircleCheck className="size-4" aria-hidden />
        {te('noProblems')}
      </p>
    )
  }

  const focus = (p: Problem): void => {
    store.set({ selection: selectionFor(p) })
    const pt = problemPoint(store.getState().doc, p)
    if (!pt) return
    const { width, height } = viewport()
    const { scale } = store.getState().view
    const k = Math.max(scale, 0.05)
    store.set({ view: { scale: k, ox: width / 2 - pt.x * k, oy: height / 2 + pt.y * k } })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {te('problemsSummary', { errors, warnings: problems.length - errors })}
      </p>
      <ul className="flex flex-col gap-1">
        {problems.slice(0, 200).map((p, i) => (
          <li key={`${p.code}-${p.path}-${i}`}>
            <button
              type="button"
              onClick={() => focus(p)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted',
                'focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none',
              )}
            >
              {p.severity === 'error' ? (
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-label={te('error')}
                />
              ) : (
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-label={te('warning')}
                />
              )}
              <span>{t(`problem_${p.code}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
