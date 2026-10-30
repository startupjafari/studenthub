import { describe, expect, it } from 'vitest'
import type { PortfolioItem, PortfolioKind } from '../../../entities/portfolio'
import { applyOrder, displayOrder, moveWithinKind } from './reorder'

function item(id: string, kind: PortfolioKind, order = 0): PortfolioItem {
  return {
    id,
    kind,
    title: id,
    organization: null,
    description: null,
    url: null,
    startDate: null,
    endDate: null,
    visibility: 'UNIVERSITY',
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

// Сервер отдаёт по `order`; экран группирует по видам, не ломая порядок внутри вида.
const server = [
  item('p1', 'PROJECT'),
  item('e1', 'EDUCATION'),
  item('p2', 'PROJECT'),
  item('e2', 'EDUCATION'),
]

describe('порядок портфолио', () => {
  it('показ — по видам, внутри вида — порядок сервера', () => {
    expect(displayOrder(server).map((i) => i.id)).toEqual(['e1', 'e2', 'p1', 'p2'])
  })

  it('сдвиг внутри вида — все id в новом порядке показа', () => {
    const shown = displayOrder(server)
    expect(moveWithinKind(shown, 1, -1)).toEqual(['e2', 'e1', 'p1', 'p2'])
    expect(moveWithinKind(shown, 2, 1)).toEqual(['e1', 'e2', 'p2', 'p1'])
  })

  it('через границу вида и за край списка — двигать некуда', () => {
    const shown = displayOrder(server)
    expect(moveWithinKind(shown, 0, -1)).toBeNull()
    expect(moveWithinKind(shown, 1, 1)).toBeNull()
    expect(moveWithinKind(shown, 2, -1)).toBeNull()
    expect(moveWithinKind(shown, 3, 1)).toBeNull()
  })

  it('оптимистичный порядок — как у сервера: перечисленные первыми, order подряд', () => {
    const next = applyOrder(server, ['e2', 'e1'])
    expect(next.map((i) => [i.id, i.order])).toEqual([
      ['e2', 0],
      ['e1', 1],
      ['p1', 2],
      ['p2', 3],
    ])
    // Устаревший id (запись удалили с другого устройства) просто пропускается.
    expect(applyOrder(server, ['gone', 'p2']).map((i) => i.id)).toEqual(['p2', 'p1', 'e1', 'e2'])
  })
})
