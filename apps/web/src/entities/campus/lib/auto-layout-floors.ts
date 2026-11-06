import {
  autoLayout,
  isBareOutlineFloor,
  type AutoLayoutError,
  type Pt,
} from '@studenthub/campus-core'
import { fetchCampusPlan, saveCampusPlan } from '../api/campus-api'

export interface AutoLayoutFloorsResult {
  done: number
  /** Этажи с уже нарисованным планом: их не трогаем. */
  kept: number
  error: AutoLayoutError | null
}

/**
 * Автопланировка всех этажей корпуса: каждый пустой этаж (одни наружные стены) получает
 * коридоры, кабинеты, лестницы и лифты по контуру. Нарисованные этажи остаются как есть —
 * их план работа автора.
 */
export async function autoLayoutFloors(
  outline: Pt[],
  floors: { id: string; level: number }[],
): Promise<AutoLayoutFloorsResult> {
  let done = 0
  let kept = 0
  for (const f of floors) {
    const plan = await fetchCampusPlan(f.id)
    if (!isBareOutlineFloor(plan.document, outline)) {
      kept++
      continue
    }
    const r = autoLayout(outline, { level: f.level })
    if ('error' in r) return { done, kept, error: r.error }
    await saveCampusPlan(f.id, { baseRevision: plan.revision, document: r.doc })
    done++
  }
  return { done, kept, error: null }
}
