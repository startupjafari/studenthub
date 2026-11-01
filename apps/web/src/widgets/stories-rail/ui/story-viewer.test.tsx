import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const auth = { user: { id: 'me' }, role: 'STUDENT' }
vi.mock('../../../shared/store', () => ({
  useAppSelector: (pick: (s: { auth: typeof auth }) => unknown) => pick({ auth }),
}))
vi.mock('../../../entities/story/api/story-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/story/api/story-api')>()
  return {
    ...actual,
    markStoryViewed: vi.fn().mockResolvedValue(undefined),
    replyToStoryRequest: vi.fn().mockResolvedValue({ chatId: 'c1' }),
    addStoryReactionRequest: vi.fn().mockResolvedValue(undefined),
    muteStoryAuthorRequest: vi.fn().mockResolvedValue(undefined),
  }
})

import {
  addStoryReactionRequest,
  markStoryViewed,
  muteStoryAuthorRequest,
  replyToStoryRequest,
  type StoryCard,
  type StoryRing,
} from '../../../entities/story'
import { ConfirmProvider } from '../../../shared/ui'
import { StoryViewer } from './story-viewer'

function card(id: string, authorId: string, over: Partial<StoryCard> = {}): StoryCard {
  return {
    id,
    audience: 'GROUP',
    text: `Текст ${id}`,
    background: 'ocean',
    linkUrl: null,
    linkLabel: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    author: {
      id: authorId,
      firstName: authorId,
      lastName: 'Автор',
      role: 'STUDENT',
      avatarUrl: null,
    },
    media: null,
    poll: null,
    reactions: [],
    seen: false,
    viewsCount: null,
    canDelete: false,
    ...over,
  } as StoryCard
}

function ring(authorId: string, stories: StoryCard[]): StoryRing {
  return { author: stories[0]!.author, stories, hasUnseen: stories.some((s) => !s.seen) }
}

function setup(rings: StoryRing[]) {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<StoryViewer rings={rings} startIndex={0} onClose={onClose} />, { wrapper })
  return { onClose, user: userEvent.setup() }
}

// jsdom не умеет прокрутку окна, а блокировка прокрутки под окном её вызывает.
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()))
afterEach(() => vi.clearAllMocks())

describe('StoryViewer', () => {
  it('открывается с первой непросмотренной сторис автора и отмечает её просмотр', async () => {
    setup([ring('anna', [card('s1', 'anna', { seen: true }), card('s2', 'anna')])])
    expect(await screen.findByText('Текст s2')).toBeInTheDocument()
    await waitFor(() => expect(markStoryViewed).toHaveBeenCalledWith('s2'))
    expect(markStoryViewed).not.toHaveBeenCalledWith('s1')
  })

  it('«Следующее» листает кадры автора, после последнего — следующий автор', async () => {
    const { user } = setup([
      ring('anna', [card('a1', 'anna'), card('a2', 'anna')]),
      ring('boris', [card('b1', 'boris')]),
    ])
    const [nextZone] = screen.getAllByRole('button', { name: 'Следующее' })
    await user.click(nextZone!)
    expect(screen.getByText('Текст a2')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Следующее' })[0]!)
    expect(screen.getByText('Текст b1')).toBeInTheDocument()
  })

  it('после последней сторис последнего автора окно закрывается', async () => {
    const { user, onClose } = setup([ring('anna', [card('a1', 'anna')])])
    await user.click(screen.getAllByRole('button', { name: 'Следующее' })[0]!)
    expect(onClose).toHaveBeenCalled()
  })

  it('пробел ставит на паузу и снимает её', async () => {
    const { user } = setup([ring('anna', [card('a1', 'anna')])])
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Воспроизвести' })).toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument()
  })

  it('меню автора: зрители и удаление; меню зрителя: профиль и жалоба', async () => {
    const own = setup([ring('me', [card('m1', 'me', { viewsCount: 3, canDelete: true })])])
    await own.user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    expect(await screen.findByRole('menuitem', { name: /3 просмотра/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Удалить/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Пожаловаться/ })).not.toBeInTheDocument()
  })

  it('чужая сторис: в меню профиль и жалоба, удаления нет', async () => {
    const { user } = setup([ring('anna', [card('a1', 'anna')])])
    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    expect(await screen.findByRole('menuitem', { name: /Открыть профиль/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Пожаловаться/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Удалить/ })).not.toBeInTheDocument()
  })

  it('ответ автору: Enter отправляет в чат, поле очищается', async () => {
    const { user } = setup([ring('anna', [card('a1', 'anna')])])
    const input = screen.getByRole('textbox', { name: 'Ответить anna…' })
    await user.type(input, 'Классно!{Enter}')
    await waitFor(() => expect(replyToStoryRequest).toHaveBeenCalledWith('a1', 'Классно!'))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('«Нравится» — это реакция ❤️; на своей сторис поля ответа нет', async () => {
    const { user } = setup([ring('anna', [card('a1', 'anna')])])
    await user.click(screen.getByRole('button', { name: 'Нравится' }))
    expect(addStoryReactionRequest).toHaveBeenCalledWith('a1', '❤️')
    expect(screen.getByRole('button', { name: 'Нравится' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('своя сторис: без поля ответа и без «Нравится»', () => {
    setup([ring('me', [card('m1', 'me', { viewsCount: 0 })])])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Нравится' })).not.toBeInTheDocument()
  })

  it('«Скрыть сторис» скрывает автора и листает к следующему', async () => {
    const { user } = setup([
      ring('anna', [card('a1', 'anna')]),
      ring('boris', [card('b1', 'boris')]),
    ])
    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    await user.click(await screen.findByRole('menuitem', { name: /Скрыть сторис/ }))
    await waitFor(() => expect(muteStoryAuthorRequest).toHaveBeenCalledWith('anna'))
    expect(await screen.findByText('Текст b1')).toBeInTheDocument()
  })
})
