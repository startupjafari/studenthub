import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('../../../shared/store', () => ({
  useAppSelector: (pick: (s: { auth: { role: Role } }) => unknown) =>
    pick({ auth: { role: Role.STUDENT } }),
}))
vi.mock('../../../entities/chat', () => ({
  createChatRequest: vi.fn().mockResolvedValue({ id: 'chat-1' }),
}))
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}))

vi.mock('../../../entities/friendship/api/friendship-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/friendship/api/friendship-api')>()
  return {
    ...actual,
    fetchFriendCount: vi.fn(),
    fetchFriends: vi.fn().mockResolvedValue([]),
    fetchFriendRequests: vi.fn().mockResolvedValue([]),
    acceptFriendRequest: vi.fn().mockResolvedValue(undefined),
    removeFriendship: vi.fn().mockResolvedValue(undefined),
  }
})

import {
  acceptFriendRequest,
  fetchFriendCount,
  fetchFriendRequests,
  fetchFriends,
  removeFriendship,
} from '../../../entities/friendship'
import { createChatRequest } from '../../../entities/chat'
import { FriendsPanel } from './friends-panel'

function user(id: string, lastName: string, firstName: string) {
  return {
    id,
    firstName,
    lastName,
    middleName: null,
    avatarUrl: null,
    avatarThumbUrl: null,
    role: Role.STUDENT,
    headline: null,
    universityId: 'un1',
    facultyId: 'f1',
    groupId: 'g1',
  }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return render(<FriendsPanel />, { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchFriends).mockResolvedValue([])
  vi.mocked(fetchFriendRequests).mockResolvedValue([])
})

describe('FriendsPanel', () => {
  it('не рисует ничего и не грузит списки, пока нет ни друзей, ни заявок', async () => {
    vi.mocked(fetchFriendCount).mockResolvedValue({ friends: 0, incomingRequests: 0 })
    const { container } = setup()

    await waitFor(() => expect(fetchFriendCount).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    // Пустых запросов быть не должно: колонка ленты открывается на каждой странице.
    expect(fetchFriends).not.toHaveBeenCalled()
    expect(fetchFriendRequests).not.toHaveBeenCalled()
  })

  it('принимает входящую заявку прямо из колонки', async () => {
    vi.mocked(fetchFriendCount).mockResolvedValue({ friends: 0, incomingRequests: 1 })
    vi.mocked(fetchFriendRequests).mockResolvedValue([
      {
        friendshipId: 'fr1',
        createdAt: '2026-08-27T10:00:00.000Z',
        user: user('u2', 'Оспанов', 'Нурлан'),
      },
    ])
    setup()

    await screen.findByText('Оспанов Нурлан')
    await userEvent.click(screen.getByRole('button', { name: 'accept: Оспанов Нурлан' }))

    await waitFor(() => expect(acceptFriendRequest).toHaveBeenCalledWith('fr1'))
    expect(removeFriendship).not.toHaveBeenCalled()
  })

  it('отклоняет входящую заявку той же строкой', async () => {
    vi.mocked(fetchFriendCount).mockResolvedValue({ friends: 0, incomingRequests: 1 })
    vi.mocked(fetchFriendRequests).mockResolvedValue([
      {
        friendshipId: 'fr1',
        createdAt: '2026-08-27T10:00:00.000Z',
        user: user('u2', 'Оспанов', 'Нурлан'),
      },
    ])
    setup()

    await screen.findByText('Оспанов Нурлан')
    await userEvent.click(screen.getByRole('button', { name: 'decline: Оспанов Нурлан' }))

    await waitFor(() => expect(removeFriendship).toHaveBeenCalledWith('fr1'))
    expect(acceptFriendRequest).not.toHaveBeenCalled()
  })

  it('показывает превью друзей строками и кнопку «показать всех»', async () => {
    vi.mocked(fetchFriendCount).mockResolvedValue({ friends: 9, incomingRequests: 0 })
    vi.mocked(fetchFriends).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        friendshipId: `f${i}`,
        since: '2026-08-01T00:00:00.000Z',
        user: user(`u${i}`, 'Серикова', `Имя${i}`),
      })),
    )
    setup()

    await screen.findByText('Серикова Имя0')
    // Ровно шесть строк — превью, а не весь список.
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(fetchFriends).toHaveBeenCalledWith(6)
    expect(screen.getByRole('button', { name: 'showAll' })).toBeInTheDocument()
  })

  it('«показать всех» есть и при коротком списке; «написать» открывает личный чат', async () => {
    vi.mocked(fetchFriendCount).mockResolvedValue({ friends: 2, incomingRequests: 0 })
    vi.mocked(fetchFriends).mockResolvedValue([
      { friendshipId: 'f1', since: null, user: user('u1', 'Серикова', 'Аружан') },
      { friendshipId: 'f2', since: null, user: user('u2', 'Оспанов', 'Нурлан') },
    ])
    setup()

    await screen.findByText('Серикова Аружан')
    expect(screen.getByRole('button', { name: 'showAll' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'write · Серикова Аружан' }))
    await waitFor(() =>
      expect(createChatRequest).toHaveBeenCalledWith({ type: 'PRIVATE', memberIds: ['u1'] }),
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('?chat=chat-1')))
  })
})
