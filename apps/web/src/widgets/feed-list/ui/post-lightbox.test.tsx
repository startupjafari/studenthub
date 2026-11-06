import { useState, type ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/feed',
  useSearchParams: () => new URLSearchParams(),
}))
const auth = { user: { id: 'me' }, role: 'STUDENT' }
vi.mock('../../../shared/store', () => ({
  useAppSelector: (pick: (s: { auth: typeof auth }) => unknown) => pick({ auth }),
}))
vi.mock('../../../entities/post/api/post-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/post/api/post-api')>()
  return {
    ...actual,
    incrementPostView: vi.fn().mockResolvedValue(1),
    fetchCommentsPage: vi.fn().mockResolvedValue({ items: [], hasNext: false, total: 0 }),
  }
})

import { fetchCommentsPage, type FeedPost } from '../../../entities/post'
import { ConfirmProvider } from '../../../shared/ui'
import { PostLightbox } from './post-lightbox'

function post(id: string, over: Partial<FeedPost> = {}): FeedPost {
  return {
    id,
    audience: 'ALL',
    title: null,
    content: `Текст ${id}`,
    authorId: 'anna',
    universityId: null,
    facultyId: null,
    groupId: null,
    targetUserId: null,
    subject: null,
    priority: 0,
    pinnedAt: null,
    originalPostId: null,
    views: 0,
    status: 'PUBLISHED',
    scheduledAt: null,
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    author: { id: 'anna', firstName: 'Анна', lastName: 'Ким', avatarUrl: null, role: 'STUDENT' },
    media: [],
    reactionSummary: [],
    original: null,
    _count: { comments: 0 },
    bookmarked: false,
    ...over,
  } as FeedPost
}

const image = (id: string) => ({
  id,
  mime: 'image/jpeg',
  url: `https://minio/${id}.jpg`,
  expiresAt: null,
  width: 800,
  height: 600,
})

function Harness({ posts, onClose }: { posts: FeedPost[]; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  return <PostLightbox posts={posts} index={index} onIndex={setIndex} onClose={onClose} />
}

function setup(posts: FeedPost[]) {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  openers.push(opener)
  opener.focus()
  const view = render(<Harness posts={posts} onClose={onClose} />, { wrapper })
  return { onClose, opener, view, user: userEvent.setup() }
}

const openers: HTMLElement[] = []
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()))
afterEach(() => {
  vi.clearAllMocks()
  for (const el of openers.splice(0)) el.remove()
})

describe('PostLightbox', () => {
  it('текстовый пост — компактное окно по высоте содержимого, без колонки медиа', async () => {
    setup([post('p1')])
    const dialog = await screen.findByRole('dialog')
    const win = dialog.querySelector('[tabindex="-1"]') as HTMLElement
    expect(win.className).toContain('sm:h-auto')
    expect(win.className).toContain('sm:max-h-full')
    expect(screen.queryByRole('button', { name: ru.Feed.zoomIn })).not.toBeInTheDocument()
  })

  it('стрелки листают сначала кадры поста, на последнем кадре — следующий пост', async () => {
    // Три кадра у поста и два поста: счётчики «из 3» (кадры) и «из 2» (посты) различимы.
    const { user } = setup([
      post('p1', { media: [image('a'), image('b'), image('c')] }),
      post('p2'),
    ])
    expect(await screen.findByText('1 из 3')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('3 из 3')).toBeInTheDocument()
    expect(screen.queryByText('Текст p2')).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Текст p2')).toBeInTheDocument()
  })

  it('кнопка зума приближает снимок и возвращает обратно', async () => {
    const { user } = setup([post('p1', { media: [image('a')] })])
    await user.click(await screen.findByRole('button', { name: ru.Feed.zoomIn }))
    expect(screen.getByRole('button', { name: ru.Feed.zoomOut })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Esc при увеличенном кадре возвращает масштаб, а не закрывает окно.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: ru.Feed.zoomIn })).toBeInTheDocument()
  })

  it('Esc закрывает окно, фокус возвращается к открывшей кнопке', async () => {
    const { user, onClose, opener, view } = setup([post('p1')])
    await screen.findByRole('dialog')
    expect(document.activeElement).not.toBe(opener)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    view.unmount()
    expect(document.activeElement).toBe(opener)
  })

  it('сбой загрузки комментариев — понятная фраза и повтор', async () => {
    vi.mocked(fetchCommentsPage).mockRejectedValueOnce(new Error('boom'))
    const { user } = setup([post('p1')])
    expect(await screen.findByText(ru.Feed.commentsError)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ru.Common.retry }))
    await waitFor(() => expect(fetchCommentsPage).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(ru.Feed.commentsEmpty)).toBeInTheDocument()
  })

  it('черновик комментария переживает закрытие окна', async () => {
    const first = setup([post('draft-1')])
    await first.user.type(await screen.findByPlaceholderText(ru.Feed.writeComment), 'Не потерять')
    first.view.unmount()
    setup([post('draft-1')])
    expect(await screen.findByPlaceholderText(ru.Feed.writeComment)).toHaveValue('Не потерять')
  })
})
