import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { scheduleKeys, type ScheduleChange } from '../../../entities/schedule'
import { keysToRefreshOnScheduleChanged } from './schedule-changed'

const RANGE = { from: '2026-10-19', to: '2026-10-25' }

// Кэш с запросами, которые держат экран расписания и соседние экраны.
function cacheWithSchedule(): QueryClient {
  const qc = new QueryClient()
  qc.setQueryData(scheduleKeys.view({}), { pairs: [] })
  qc.setQueryData(scheduleKeys.view({ groupId: 'g-1' }), { pairs: [] })
  qc.setQueryData(scheduleKeys.changes(RANGE), [])
  qc.setQueryData(scheduleKeys.containers('g-1'), [])
  return qc
}

async function refreshed(payload: unknown) {
  const qc = cacheWithSchedule()
  for (const queryKey of keysToRefreshOnScheduleChanged(payload)) {
    await qc.invalidateQueries({ queryKey })
  }
  const stale = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated ?? false
  return {
    views: [stale(scheduleKeys.view({})), stale(scheduleKeys.view({ groupId: 'g-1' }))],
    changes: stale(scheduleKeys.changes(RANGE)),
    containers: stale(scheduleKeys.containers('g-1')),
  }
}

describe('keysToRefreshOnScheduleChanged — schedule:changed', () => {
  it('правка пары действующей сетки перечитывает саму сетку по всем фильтрам', async () => {
    expect(await refreshed({ change: null, groupId: 'g-1', pairId: 'p-1' })).toEqual({
      views: [true, true],
      changes: true,
      containers: false,
    })
  })

  it('удаление пары — тоже сетка и изменения', async () => {
    const r = await refreshed({ change: null, groupId: 'g-1', pairId: 'p-1', removed: true })
    expect(r.views).toEqual([true, true])
    expect(r.changes).toBe(true)
  })

  it('разовое изменение — только выборка изменений, сетка не перечитывается', async () => {
    const change = { id: 'c-1', pairId: 'p-1', type: 'CANCELLED' } as ScheduleChange
    expect(await refreshed({ change, groupId: 'g-1' })).toEqual({
      views: [false, false],
      changes: true,
      containers: false,
    })
  })

  it('нераспознанный payload — перечитываем и сетку, чтобы не показать устаревшее', async () => {
    expect((await refreshed(undefined)).views).toEqual([true, true])
  })
})
