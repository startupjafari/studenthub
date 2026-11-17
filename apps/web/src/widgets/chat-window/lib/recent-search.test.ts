import { beforeEach, describe, expect, it } from 'vitest'
import {
  RECENT_SEARCH_LIMIT,
  clearRecentSearch,
  pushRecentSearch,
  readRecentSearch,
  removeRecentSearch,
} from './recent-search'

describe('недавние глобального поиска', () => {
  beforeEach(() => localStorage.clear())

  it('свежий выбор — первым, без повторов', () => {
    pushRecentSearch('u1', 'a')
    pushRecentSearch('u1', 'b')
    expect(pushRecentSearch('u1', 'a')).toEqual(['a', 'b'])
    expect(readRecentSearch('u1')).toEqual(['a', 'b'])
  })

  it('у каждого человека свой список', () => {
    pushRecentSearch('u1', 'a')
    expect(readRecentSearch('u2')).toEqual([])
  })

  it('без человека ничего не хранится', () => {
    expect(pushRecentSearch(undefined, 'a')).toEqual([])
    expect(readRecentSearch(undefined)).toEqual([])
  })

  it('список ограничен', () => {
    for (let i = 0; i < RECENT_SEARCH_LIMIT + 5; i += 1) pushRecentSearch('u1', `c${i}`)
    expect(readRecentSearch('u1')).toHaveLength(RECENT_SEARCH_LIMIT)
  })

  it('убрать один и очистить все', () => {
    pushRecentSearch('u1', 'a')
    pushRecentSearch('u1', 'b')
    expect(removeRecentSearch('u1', 'b')).toEqual(['a'])
    clearRecentSearch('u1')
    expect(readRecentSearch('u1')).toEqual([])
  })

  it('испорченное значение в хранилище — пустой список', () => {
    localStorage.setItem('sh_chat_recent_search:u1', '{oops')
    expect(readRecentSearch('u1')).toEqual([])
  })
})
