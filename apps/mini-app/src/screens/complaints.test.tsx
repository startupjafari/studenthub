import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Complaint, ComplaintStatus } from '../api/complaints'

vi.mock('../api/complaints', async (orig) => {
  const actual = await orig<typeof import('../api/complaints')>()
  return {
    ...actual,
    fetchComplaints: vi.fn(),
    fetchComplaint: vi.fn(),
  }
})
vi.mock('../telegram/webapp', () => ({
  haptic: {
    tap: vi.fn(),
    snap: vi.fn(),
    select: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  confirmAction: vi.fn().mockResolvedValue(true),
  hasBottomButtons: () => false,
  webApp: () => null,
  isTelegram: () => false,
}))
vi.mock('../telegram/use-telegram', () => ({
  useBackButton: vi.fn(),
  useMainButton: vi.fn(),
  useSecondaryButton: vi.fn(),
}))

import { fetchComplaints } from '../api/complaints'
import { ComplaintsScreen } from './complaints'

function complaint(over: Partial<Complaint> = {}): Complaint {
  return {
    id: 'c1',
    targetType: 'POST',
    targetId: 'p1',
    reason: 'Реклама в ленте',
    status: 'PENDING',
    priority: 'MEDIUM',
    createdAt: new Date().toISOString(),
    reporter: { id: 'u1', firstName: 'Айгуль', lastName: 'Серикова' },
    ...over,
  }
}

/** Ответ по статусам: вкладка спрашивает каждый статус отдельным запросом. */
function byStatus(pages: Partial<Record<ComplaintStatus, Complaint[]>>) {
  vi.mocked(fetchComplaints).mockImplementation(async ({ status }) => {
    const items = pages[status] ?? []
    return { items, total: items.length }
  })
}

function page(items: Complaint[], total = items.length) {
  vi.mocked(fetchComplaints).mockImplementation(async ({ status }) =>
    status === 'PENDING' || status === 'RESOLVED' ? { items, total } : { items: [], total: 0 },
  )
}

function statusesAsked(): string[] {
  return vi.mocked(fetchComplaints).mock.calls.map(([query]) => query.status)
}

describe('ComplaintsScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('показывает очередь', async () => {
    page([complaint()], 7)
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Реклама в ленте')).toBeInTheDocument()
  })

  it('на пустой очереди зовёт разбор законченным', async () => {
    page([], 0)
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Пока тихо')).toBeInTheDocument()
  })

  it('сообщает об ошибке загрузки и даёт повторить', async () => {
    vi.mocked(fetchComplaints).mockRejectedValue(new Error('offline'))
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Не удалось загрузить очередь')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('фильтр по приоритету уходит на сервер, а не режет список на клиенте', async () => {
    page([complaint()])
    render(<ComplaintsScreen />)
    await screen.findByText('Реклама в ленте')

    vi.mocked(fetchComplaints).mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Срочно' }))

    await waitFor(() =>
      expect(vi.mocked(fetchComplaints).mock.calls.map(([query]) => query)).toEqual([
        expect.objectContaining({ status: 'PENDING', priority: 'HIGH' }),
        expect.objectContaining({ status: 'REVIEWING', priority: 'HIGH' }),
      ]),
    )
  })

  it('вкладка «Разобранные» запрашивает и решённые, и отклонённые', async () => {
    page([complaint()])
    render(<ComplaintsScreen />)
    await screen.findByText('Реклама в ленте')

    vi.mocked(fetchComplaints).mockClear()
    await userEvent.click(screen.getByRole('tab', { name: 'Разобранные' }))

    await waitFor(() => expect(statusesAsked()).toEqual(['RESOLVED', 'DISMISSED']))
  })

  // Взятая свайпом жалоба остаётся в очереди: решать её всё ещё нужно (как OPEN_STATUSES).
  it('в очереди есть и взятые в разбор', async () => {
    byStatus({
      PENDING: [complaint()],
      REVIEWING: [
        complaint({
          id: 'c2',
          status: 'REVIEWING',
          reason: 'Оскорбления в чате',
          reviewingBy: { id: 'm1', firstName: 'Ерлан', lastName: 'Ахметов' },
        }),
      ],
    })
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Реклама в ленте')).toBeInTheDocument()
    expect(screen.getByText('Оскорбления в чате')).toBeInTheDocument()
  })

  // Очередь больше страницы не обрезается молча: видно, сколько показано, и можно дозагрузить.
  it('говорит, что показана не вся очередь, и дозагружает', async () => {
    page([complaint()], 45)
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Показаны 1 из 45')).toBeInTheDocument()
    vi.mocked(fetchComplaints).mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))

    await waitFor(() =>
      expect(vi.mocked(fetchComplaints).mock.calls[0]?.[0]).toMatchObject({ limit: 60 }),
    )
  })

  it('группирует список по дням', async () => {
    const old = new Date()
    old.setDate(old.getDate() - 3)
    page([complaint(), complaint({ id: 'c2', createdAt: old.toISOString() })])
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Сегодня')).toBeInTheDocument()
  })
})
