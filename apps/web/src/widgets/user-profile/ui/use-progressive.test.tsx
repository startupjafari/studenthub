import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Пересечение маячка с экраном в jsdom не наступает — подменяем хук прокрутки и зовём
// его onLoad сами, как это сделал бы IntersectionObserver.
interface ScrollOpts {
  hasNext: boolean
  loading: boolean
  onLoad: () => void
}
const scroll: { last: ScrollOpts | null } = { last: null }
vi.mock('../../../shared/lib', () => ({
  useInfiniteScroll: (opts: ScrollOpts) => {
    scroll.last = opts
    return vi.fn()
  },
}))

import { useProgressive } from './use-progressive'

function setup(total: number, step: number, resetKey = 'k') {
  return renderHook((p: { total: number; key: string }) => useProgressive(p.total, step, p.key), {
    initialProps: { total, key: resetKey },
  })
}

// E-F27: поэтапный показ мозаики профиля — порции, скелетоны хвоста и сброс по фильтру.
describe('useProgressive', () => {
  it('первая порция и скелетоны ровно на места следующей', () => {
    const { result } = setup(30, 14)
    expect(result.current.shown).toBe(14)
    expect(result.current.pending).toBe(14)
    expect(scroll.last?.hasNext).toBe(true)
  })

  it('маячок у экрана — следующая порция; в конце скелетонов нет', () => {
    const { result } = setup(30, 14)
    act(() => scroll.last?.onLoad())
    expect(result.current.shown).toBe(28)
    expect(result.current.pending).toBe(2)
    act(() => scroll.last?.onLoad())
    expect(result.current.shown).toBe(30)
    expect(result.current.pending).toBe(0)
    expect(scroll.last?.hasNext).toBe(false)
  })

  it('список короче порции — всё сразу, хвоста нет', () => {
    const { result } = setup(5, 14)
    expect(result.current.shown).toBe(5)
    expect(result.current.pending).toBe(0)
    expect(scroll.last?.hasNext).toBe(false)
  })

  it('смена фильтра или сортировки — снова с первой порции', () => {
    const { result, rerender } = setup(40, 14, 'PHOTO|all|new')
    act(() => scroll.last?.onLoad())
    expect(result.current.shown).toBe(28)
    rerender({ total: 40, key: 'PHOTO|all|old' })
    expect(result.current.shown).toBe(14)
  })

  it('пока порция встаёт на место, повторной загрузки нет', () => {
    setup(40, 14)
    act(() => scroll.last?.onLoad())
    // Кадр после порции хук сообщает «загружаю» — маячок не дёргает onLoad второй раз.
    expect(scroll.last?.loading).toBe(true)
  })
})
