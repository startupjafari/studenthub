import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'

// Исходник догружается сетью — глушим сам запрос, проверяем, КОГДА он уходит.
vi.mock('../../../entities/post/api/post-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/post/api/post-api')>()
  return { ...actual, fetchPost: vi.fn() }
})

import { fetchPost, type FeedPost } from '../../../entities/post'
import { useRepostSource } from './use-repost-source'

const author = { id: 'u2', firstName: 'А', lastName: 'Б', role: Role.TEACHER, avatarUrl: null }

const base = {
  id: 'r1',
  audience: 'GROUP',
  title: null,
  content: '',
  authorId: 'u2',
  universityId: 'un1',
  facultyId: null,
  groupId: 'g1',
  targetUserId: null,
  subject: null,
  priority: 30,
  pinnedAt: null,
  originalPostId: null,
  views: 0,
  status: 'PUBLISHED',
  scheduledAt: null,
  publishedAt: '2026-08-21T09:00:00.000Z',
  createdAt: '2026-08-21T09:00:00.000Z',
  author,
  media: [],
  reactions: [],
  original: null,
  _count: { comments: 0 },
  bookmarked: false,
} satisfies FeedPost

function run(post: FeedPost) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return renderHook(() => useRepostSource(post), { wrapper })
}

describe('useRepostSource', () => {
  // В фигурных скобках: функцию, возвращённую из beforeEach, vitest вызывает как уборку
  // после теста, а mockReset возвращает сам мок.
  beforeEach(() => {
    vi.mocked(fetchPost).mockReset()
  })

  it('обычный пост — plain, без запросов', () => {
    const { result } = run(base)
    expect(result.current).toEqual({ kind: 'plain' })
    expect(fetchPost).not.toHaveBeenCalled()
  })

  // Сервер не отдал цитату: исходник удалён, снят модератором или адресован чужой
  // аудитории. Запрашивать его бессмысленно — и показывать нечего.
  it('репост без цитаты — сразу unavailable, исходник не запрашивается', () => {
    const { result } = run({ ...base, originalPostId: 'o1', original: null })
    expect(result.current).toEqual({ kind: 'unavailable' })
    expect(fetchPost).not.toHaveBeenCalled()
  })

  it('исходник пропал после загрузки ленты (404) — unavailable, а не старая цитата', async () => {
    vi.mocked(fetchPost).mockRejectedValue(new Error('NOT_FOUND'))
    const { result } = run({
      ...base,
      originalPostId: 'o1',
      original: { id: 'o1', title: null, content: 'снятый текст', author },
    })
    await waitFor(() => expect(result.current).toEqual({ kind: 'unavailable' }))
    expect(fetchPost).toHaveBeenCalledWith('o1')
  })
})
