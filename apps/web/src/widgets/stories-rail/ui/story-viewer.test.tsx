import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
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
vi.mock('../../../entities/event/api/event-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/event/api/event-api')>()
  return { ...actual, registerEventRequest: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('../../../entities/story/api/story-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/story/api/story-api')>()
  return {
    ...actual,
    markStoryViewed: vi.fn().mockResolvedValue(undefined),
    replyToStoryRequest: vi.fn().mockResolvedValue({ chatId: 'c1' }),
    addStoryReactionRequest: vi.fn().mockResolvedValue(undefined),
    muteStoryAuthorRequest: vi.fn().mockResolvedValue(undefined),
    removeStoryHighlightItemRequest: vi.fn().mockResolvedValue({ deleted: false }),
    updateStoryHighlightRequest: vi.fn().mockResolvedValue({}),
    voteStoryRequest: vi.fn(),
  }
})

import {
  addStoryReactionRequest,
  markStoryViewed,
  muteStoryAuthorRequest,
  removeStoryHighlightItemRequest,
  replyToStoryRequest,
  updateStoryHighlightRequest,
  voteStoryRequest,
  type StoryCard,
  type StoryRing,
} from '../../../entities/story'
import { registerEventRequest } from '../../../entities/event'
import { ConfirmProvider } from '../../../shared/ui'
import { StoryViewer, type ViewerHighlight } from './story-viewer'

function card(id: string, authorId: string, over: Partial<StoryCard> = {}): StoryCard {
  return {
    id,
    audience: 'GROUP',
    audienceUsers: null,
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

function setup(rings: StoryRing[], highlight?: ViewerHighlight) {
  const onClose = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(
    <StoryViewer
      rings={rings}
      startIndex={0}
      onClose={onClose}
      highlights={highlight ? [highlight] : undefined}
    />,
    { wrapper },
  )
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

  it('у официального аккаунта — значок рядом с именем', () => {
    const official = card('o1', 'rector')
    official.author = { ...official.author, role: 'UNIVERSITY_ADMIN' } as never
    setup([ring('rector', [official])])
    expect(screen.getByText(ru.Stories.officialAccount)).toBeInTheDocument()
  })

  it('«Участвовать» на стикере события регистрирует и сразу показывает «Вы участвуете»', async () => {
    const withEvent = card('a1', 'anna', {
      elements: [
        {
          type: 'event',
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          eventId: 'e-1',
          event: {
            id: 'e-1',
            title: 'Хакатон',
            startsAt: new Date(Date.now() + 86_400_000).toISOString(),
            endsAt: null,
            location: null,
            isOnline: true,
            isRegistered: false,
          },
        },
      ],
    } as never)
    const { user } = setup([ring('anna', [withEvent])])
    await user.click(screen.getByRole('button', { name: ru.Stories.eventJoin }))
    await waitFor(() => expect(registerEventRequest).toHaveBeenCalledWith('e-1'))
    expect(await screen.findByText(ru.Stories.eventJoined)).toBeInTheDocument()
  })

  it('своя сторис: в меню «Добавить в актуальное» и смена аудитории с текущей', async () => {
    const { user } = setup([
      ring('me', [card('m1', 'me', { audience: 'FRIENDS', viewsCount: 0, canDelete: true })]),
    ])
    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    expect(
      await screen.findByRole('menuitem', { name: ru.Stories.addToHighlight }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: new RegExp(ru.Feed.audienceFRIENDS) }),
    ).toBeInTheDocument()
  })
})

describe('StoryViewer — «Актуальное»', () => {
  const highlight = { id: 'h-1', title: 'Хакатон', canEdit: false }

  it('снимок: без отметки просмотра, ответа и реакций; в шапке — название', async () => {
    setup([ring('anna', [card('i1', 'anna', { seen: true })])], highlight)
    expect(await screen.findByText('Текст i1')).toBeInTheDocument()
    expect(screen.getByText('Хакатон')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Нравится' })).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 0))
    expect(markStoryViewed).not.toHaveBeenCalled()
  })

  it('чужому — только профиль в меню, без жалобы и скрытия', async () => {
    const { user } = setup([ring('anna', [card('i1', 'anna', { seen: true })])], highlight)
    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    expect(await screen.findByRole('menuitem', { name: /Открыть профиль/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Пожаловаться/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Скрыть сторис/ })).not.toBeInTheDocument()
  })

  it('владельцу: обложка и «Убрать из актуального» с подтверждением', async () => {
    const { user } = setup([ring('me', [card('i1', 'me', { seen: true })])], {
      ...highlight,
      canEdit: true,
    })
    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    await user.click(await screen.findByRole('menuitem', { name: ru.Stories.highlightMakeCover }))
    await waitFor(() =>
      expect(updateStoryHighlightRequest).toHaveBeenCalledWith('h-1', { coverItemId: 'i1' }),
    )

    await user.click(screen.getByRole('button', { name: 'Действия со сторис' }))
    await user.click(await screen.findByRole('menuitem', { name: ru.Stories.highlightRemoveItem }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(removeStoryHighlightItemRequest).toHaveBeenCalledWith('h-1', 'i1'))
  })

  describe('интерактивный слой', () => {
    const poll = (n: number, votes = 0) => ({
      id: 'p1',
      question: 'Куда идём после пар?',
      options: Array.from({ length: n }, (_, i) => ({
        id: `o${i}`,
        text: `Вариант ${i + 1}`,
        order: i,
        votes: i === 0 ? votes : 0,
      })),
      totalVotes: votes,
      myOptionId: null as string | null,
    })
    const mention = (userId: string, name: string) => ({
      type: 'mention' as const,
      x: 0.5,
      y: 0.95,
      scale: 1,
      rotation: 0,
      userId,
      name,
    })

    it('ссылка — компактный стикер: открывается в новой вкладке без доступа к окну', () => {
      setup([
        ring('anna', [
          card('s1', 'anna', { linkUrl: 'https://kremlin.ru/x', linkLabel: 'Кремль' }),
        ]),
      ])
      const link = screen.getByRole('link', { name: /Кремль/ })
      expect(link).toHaveAttribute('href', 'https://kremlin.ru/x')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
    })

    it('ссылка с небезопасной схемой не рисуется вовсе', () => {
      setup([ring('anna', [card('s1', 'anna', { linkUrl: 'javascript:alert(1)' })])])
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('голос: пока запрос идёт, варианты ждут, повторный не уходит; после — проценты', async () => {
      let resolve: (v: StoryCard) => void = () => undefined
      vi.mocked(voteStoryRequest).mockReturnValue(new Promise((r) => (resolve = r)))
      const s1 = card('s1', 'anna', { poll: poll(2) })
      const { user } = setup([ring('anna', [s1])])
      await user.click(screen.getByRole('button', { name: 'Вариант 1' }))
      expect(screen.getByRole('button', { name: 'Вариант 2' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: 'Вариант 2' }))
      expect(voteStoryRequest).toHaveBeenCalledTimes(1)
      resolve({ ...s1, poll: { ...poll(2, 3), myOptionId: 'o0' } })
      expect(await screen.findByRole('button', { name: 'Вариант 1: 100%' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('опрос, ссылка и люди — вкладками; «Упомянуты» открывает список, Esc закрывает его, а не сторис', async () => {
      const { user, onClose } = setup([
        ring('anna', [
          card('s1', 'anna', {
            poll: poll(2),
            linkUrl: 'https://example.com',
            linkLabel: 'Сайт',
            elements: [mention('u1', 'Аня Ким'), mention('u2', 'Ержан Абишев')],
          }),
        ]),
      ])
      const tabs = screen.getAllByRole('tab')
      expect(tabs.map((t) => t.textContent)).toEqual(['Опрос', 'Ссылка', 'Люди · 2'])
      expect(screen.getByRole('button', { name: 'Вариант 1' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Сайт/ })).not.toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: /Люди/ }))
      await user.click(screen.getByRole('button', { name: 'Упомянуты · 2' }))
      const sheet = screen.getByRole('dialog', { name: 'Отмечены в сторис' })
      expect(within(sheet).getByRole('button', { name: /Ержан Абишев/ })).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog', { name: 'Отмечены в сторис' })).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('раскрытая панель ставит сторис на паузу: кадр не листается', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const { user } = setup([
          ring('anna', [
            card('s1', 'anna', {
              elements: [mention('u1', 'Аня Ким'), mention('u2', 'Ержан Абишев')],
            }),
            card('s2', 'anna'),
          ]),
        ])
        await user.click(screen.getByRole('button', { name: 'Упомянуты · 2' }))
        vi.advanceTimersByTime(8000)
        expect(screen.getByText('Текст s1')).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
