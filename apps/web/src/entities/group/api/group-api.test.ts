import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaged } from '../../../shared/api'
import { fetchGroupsPaged, groupKeys } from './group-api'

vi.mock('../../../shared/api', () => ({ api: {}, getPaged: vi.fn() }))

const mockedGetPaged = vi.mocked(getPaged)

describe('fetchGroupsPaged', () => {
  // Тело в фигурных скобках: функция, которую вернул beforeEach, vitest вызывает после
  // теста как очистку — а mockReset возвращает сам мок.
  beforeEach(() => {
    mockedGetPaged.mockReset()
    mockedGetPaged.mockResolvedValue({ items: [], total: 0 })
  })

  it('одна страница с поиском на сервере, а не выгрузка всех групп', async () => {
    await fetchGroupsPaged({ search: 'ит-23', limit: 20 })
    expect(mockedGetPaged).toHaveBeenCalledTimes(1)
    expect(mockedGetPaged).toHaveBeenCalledWith('/groups', {
      page: 1,
      limit: 20,
      search: 'ит-23',
    })
  })

  it('страница и размер экрана групп уходят как есть', async () => {
    await fetchGroupsPaged({ page: 5, limit: 100 })
    expect(mockedGetPaged).toHaveBeenCalledWith('/groups', { page: 5, limit: 100 })
  })
})

describe('groupKeys', () => {
  // Создание группы и назначение старосты сбрасывают `list()` — по префиксу это должно
  // задевать и страницы экрана групп, и выдачу пикеров.
  it('ключ страницы начинается с ключа списка того же факультета', () => {
    const page = groupKeys.page({ page: 2, limit: 20, search: 'a' })
    expect(page.slice(0, 3)).toEqual([...groupKeys.list()])

    const byFaculty = groupKeys.page({ facultyId: 'fac-1', limit: 20 })
    expect(byFaculty.slice(0, 3)).toEqual([...groupKeys.list('fac-1')])
  })
})
