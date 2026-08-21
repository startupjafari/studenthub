import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Мутация бьёт по сети — глушим сам запрос, проверяем ПЕРЕДАННОЕ ТЕЛО.
vi.mock('../../../entities/post/api/post-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/post/api/post-api')>()
  return { ...actual, repostRequest: vi.fn().mockResolvedValue({ id: 'new' }) }
})

import { repostRequest } from '../../../entities/post'
import { store, setAuth } from '../../../shared/store'
import type { FeedPost } from '../../../entities/post'
import { RepostDialog } from './repost-dialog'

const author = {
  id: 'u2',
  firstName: 'Айгуль',
  lastName: 'Сериковна',
  role: Role.TEACHER,
  avatarUrl: null,
}

const post = {
  id: 'p1',
  audience: 'GROUP',
  content: 'Итоги олимпиады',
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
} satisfies FeedPost

function setup(onClose = vi.fn()) {
  store.dispatch(
    setAuth({
      user: { id: 'u1', firstName: 'Мади', lastName: 'Абенов', avatarUrl: null },
      role: Role.STUDENT,
      universityId: 'un1',
      facultyId: 'f1',
      groupId: 'g1',
      accessToken: 'token',
    }),
  )
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </Provider>
  )
  render(<RepostDialog post={post} onClose={onClose} />, { wrapper })
  return { onClose }
}

describe('RepostDialog', () => {
  beforeEach(() => vi.mocked(repostRequest).mockClear())

  it('показывает цитату оригинала — что именно репостится', () => {
    setup()
    expect(screen.getByText('Итоги олимпиады')).toBeInTheDocument()
    expect(screen.getByText(/Сериковна/)).toBeInTheDocument()
  })

  it('репост с комментарием: аудитория по умолчанию + текст уходят на сервер', async () => {
    const { onClose } = setup()
    await userEvent.type(screen.getByLabelText('repostComment'), 'Поздравляю!')
    await userEvent.click(screen.getByRole('button', { name: 'repost' }))

    await waitFor(() => expect(repostRequest).toHaveBeenCalledTimes(1))
    expect(repostRequest).toHaveBeenCalledWith('p1', {
      audience: 'GROUP',
      content: 'Поздравляю!',
      groupId: undefined,
      facultyId: undefined,
      targetUserId: undefined,
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('без комментария content не отправляется — репост «как есть»', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'repost' }))
    await waitFor(() => expect(repostRequest).toHaveBeenCalledTimes(1))
    expect(vi.mocked(repostRequest).mock.calls[0]?.[1].content).toBeUndefined()
  })
})
