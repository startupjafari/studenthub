import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaged } from '../../../shared/api'
import { fetchAllGroups, type Group } from './group-api'

vi.mock('../../../shared/api', () => ({ api: {}, getPaged: vi.fn() }))

const mockedGetPaged = vi.mocked(getPaged)

function group(id: string): Group {
  return {
    id,
    name: id,
    year: null,
    facultyId: 'fac-1',
    universityId: 'uni-1',
    starostaId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

// Страница `page` из `total` групп по 100, ids — g<номер>.
function serve(total: number) {
  mockedGetPaged.mockImplementation(async (_url, params) => {
    const page = params.page as number
    const from = (page - 1) * 100
    const count = Math.max(0, Math.min(100, total - from))
    return { items: Array.from({ length: count }, (_, i) => group(`g${from + i}`)), total }
  })
}

describe('fetchAllGroups', () => {
  // Тело в фигурных скобках: функция, которую вернул beforeEach, vitest вызывает после
  // теста как очистку — а mockReset возвращает сам мок.
  beforeEach(() => {
    mockedGetPaged.mockReset()
  })

  it('собирает все страницы, а не первые 100 групп', async () => {
    serve(250)
    const groups = await fetchAllGroups()
    expect(groups).toHaveLength(250)
    expect(groups.at(-1)?.id).toBe('g249')
    expect(mockedGetPaged).toHaveBeenCalledTimes(3)
    expect(mockedGetPaged).toHaveBeenCalledWith(
      '/groups',
      expect.objectContaining({ page: 3, limit: 100 }),
    )
  })

  it('одна страница — один запрос', async () => {
    serve(40)
    expect(await fetchAllGroups()).toHaveLength(40)
    expect(mockedGetPaged).toHaveBeenCalledTimes(1)
  })

  it('дубль на стыке страниц убирается', async () => {
    mockedGetPaged.mockImplementation(async (_url, params) =>
      params.page === 1
        ? { items: [group('a'), group('b')], total: 101 }
        : { items: [group('b'), group('c')], total: 101 },
    )
    const groups = await fetchAllGroups()
    expect(groups.map((g) => g.id)).toEqual(['a', 'b', 'c'])
  })

  it('не больше 20 страниц, даже если total огромный', async () => {
    serve(100_000)
    await fetchAllGroups()
    expect(mockedGetPaged).toHaveBeenCalledTimes(20)
  })
})
