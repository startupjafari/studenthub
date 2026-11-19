import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { postKeys } from '../api/post-api'
import { cachedRepostIds } from './live'
import type { FeedPost } from './types'

// Репосты правленого или удалённого исходника ищутся по `originalPostId` во всех выдачах:
// сигнал приходит по id исходника, а цитату держит репост (§9.2d).

const post = (id: string, originalPostId: string | null = null) =>
  ({ id, originalPostId, _count: { comments: 0 } }) as unknown as FeedPost

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('cachedRepostIds', () => {
  it('находит репосты в лентах и на странице поста, без повторов', () => {
    const qc = client()
    qc.setQueryData(postKeys.feed(), {
      pages: [{ items: [post('p1'), post('r1', 'p1'), post('r2', 'other')] }],
      pageParams: [undefined],
    })
    qc.setQueryData(postKeys.author('u1'), {
      pages: [{ items: [post('r1', 'p1')] }],
      pageParams: [undefined],
    })
    qc.setQueryData(postKeys.detail('r3'), post('r3', 'p1'))

    expect(cachedRepostIds(qc, 'p1').sort()).toEqual(['r1', 'r3'])
  })

  it('обсуждение под тем же ключом — не посты, его не читает', () => {
    const qc = client()
    qc.setQueryData(postKeys.comments('p1'), {
      pages: [{ items: [{ id: 'c1', originalPostId: 'p1' }] }],
      pageParams: [undefined],
    })
    expect(cachedRepostIds(qc, 'p1')).toEqual([])
  })
})
