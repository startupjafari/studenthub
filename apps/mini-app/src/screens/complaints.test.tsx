import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Complaint } from '../api/complaints'

vi.mock('../api/complaints', async (orig) => {
  const actual = await orig<typeof import('../api/complaints')>()
  return { ...actual, fetchComplaints: vi.fn(), fetchComplaint: vi.fn() }
})
vi.mock('../telegram/webapp', () => ({
  haptic: { tap: vi.fn(), select: vi.fn(), success: vi.fn() },
  confirmAction: vi.fn().mockResolvedValue(true),
  webApp: () => null,
  isTelegram: () => false,
}))
vi.mock('../telegram/use-telegram', () => ({ useBackButton: vi.fn(), useMainButton: vi.fn() }))

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

function page(items: Complaint[], total = items.length) {
  vi.mocked(fetchComplaints).mockResolvedValue({ items, total })
}

describe('ComplaintsScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('показывает очередь и её размер', async () => {
    page([complaint()], 7)
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Реклама в ленте')).toBeInTheDocument()
    expect(screen.getByText(/7 в очереди/)).toBeInTheDocument()
  })

  /**
   * «Самая старая ждёт…» показывается, только когда вся очередь уместилась на странице.
   * Иначе это была бы самая старая ИЗ ЗАГРУЖЕННЫХ — то есть неправда.
   */
  it('не обещает возраст самой старой, когда очередь не поместилась', async () => {
    page([complaint()], 40)
    render(<ComplaintsScreen />)

    await screen.findByText('Реклама в ленте')
    expect(screen.queryByText(/ждёт/)).not.toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Срочно' }))

    expect(vi.mocked(fetchComplaints).mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'PENDING',
      priority: 'HIGH',
    })
  })

  it('вкладка «Разобранные» запрашивает другой статус', async () => {
    page([complaint()])
    render(<ComplaintsScreen />)
    await screen.findByText('Реклама в ленте')

    await userEvent.click(screen.getByRole('tab', { name: 'Разобранные' }))

    expect(vi.mocked(fetchComplaints).mock.calls.at(-1)?.[0]).toMatchObject({ status: 'RESOLVED' })
  })

  it('группирует список по дням', async () => {
    const old = new Date()
    old.setDate(old.getDate() - 3)
    page([complaint(), complaint({ id: 'c2', createdAt: old.toISOString() })])
    render(<ComplaintsScreen />)

    expect(await screen.findByText('Сегодня')).toBeInTheDocument()
  })
})
