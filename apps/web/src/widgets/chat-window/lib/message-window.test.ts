import { describe, expect, it } from 'vitest'
import {
  HISTORY_PAGE,
  WINDOW_LIMIT,
  indexAtOffset,
  preloadDistance,
  scrollTargetFor,
  trimNewest,
  trimOldest,
} from './message-window'

const rows = (n: number, prefix = 'm') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }))

describe('окно истории ленты', () => {
  it('страница — 50 сообщений (потолок API), окно — четыре страницы', () => {
    expect(HISTORY_PAGE).toBe(50)
    expect(WINDOW_LIMIT).toBe(200)
  })

  it('догрузка начинается за три экрана, но не ближе 1200px', () => {
    expect(preloadDistance(800)).toBe(2400)
    expect(preloadDistance(300)).toBe(1200)
  })

  it('после догрузки старых окно режется снизу, курсор — на последнем оставшемся', () => {
    const list = rows(300)
    const { list: kept, cursor } = trimNewest(list)
    expect(kept).toHaveLength(WINDOW_LIMIT)
    expect(kept[0]?.id).toBe('m0')
    expect(cursor).toBe(`m${WINDOW_LIMIT - 1}`)
  })

  it('после догрузки новых окно режется сверху, курсор — на первом оставшемся', () => {
    const { list: kept, cursor } = trimOldest(rows(300))
    expect(kept).toHaveLength(WINDOW_LIMIT)
    expect(kept[kept.length - 1]?.id).toBe('m299')
    expect(cursor).toBe(`m${300 - WINDOW_LIMIT}`)
  })

  it('окно в пределах лимита не трогается и курсора не даёт', () => {
    const list = rows(100)
    expect(trimNewest(list)).toEqual({ list })
    expect(trimOldest(list)).toEqual({ list })
  })

  it('свои недоотправленные сообщения снизу не отрезаются', () => {
    const list = [...rows(WINDOW_LIMIT + 5), { id: 'tmp:abc' }]
    const { list: kept, cursor } = trimNewest(list)
    expect(kept).toHaveLength(list.length)
    expect(cursor).toBeUndefined()
  })

  it('строка по отступу — двоичным поиском по верхним краям', () => {
    const tops = [0, 100, 250, 400]
    expect(indexAtOffset(tops, -10)).toBe(0)
    expect(indexAtOffset(tops, 0)).toBe(0)
    expect(indexAtOffset(tops, 99)).toBe(0)
    expect(indexAtOffset(tops, 100)).toBe(1)
    expect(indexAtOffset(tops, 260)).toBe(2)
    expect(indexAtOffset(tops, 9999)).toBe(3)
    expect(indexAtOffset([], 10)).toBe(-1)
  })

  it('цель прокрутки к строке — по выравниванию и в пределах ленты', () => {
    const view = { scrollTop: 500, height: 400, maxScroll: 2000 }
    const row = { top: 1000, height: 100 }
    expect(scrollTargetFor(row, view, 'start')).toBe(1000)
    expect(scrollTargetFor(row, view, 'end')).toBe(700)
    expect(scrollTargetFor(row, view, 'center')).toBe(850)
    // Уже в кадре — «ближайшее» не двигает ленту.
    expect(scrollTargetFor({ top: 600, height: 100 }, view, 'nearest')).toBe(500)
    expect(scrollTargetFor({ top: 100, height: 50 }, view, 'nearest')).toBe(100)
    // За границами — зажимается.
    expect(scrollTargetFor({ top: 5000, height: 10 }, view, 'start')).toBe(2000)
    expect(scrollTargetFor({ top: 10, height: 10 }, view, 'end')).toBe(0)
  })
})
