import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PersonCard } from '../api/people'

vi.mock('../api/people', async (orig) => {
  const actual = await orig<typeof import('../api/people')>()
  return { ...actual, fetchPersonCard: vi.fn() }
})

import { fetchPersonCard } from '../api/people'
import { PersonSummary } from './person-summary'

function card(over: Partial<PersonCard> = {}): PersonCard {
  return {
    id: 'u1',
    firstName: 'Айгуль',
    lastName: 'Серикова',
    role: 'STUDENT',
    isBlocked: false,
    createdAt: '2025-09-14T10:00:00.000Z',
    university: { id: 'uni1', name: 'КазНУ' },
    complaints: { total: 0, upheld: 0 },
    ...over,
  }
}

describe('PersonSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('показывает роль и вуз: ими объясняется половина жалоб и вопросов', async () => {
    vi.mocked(fetchPersonCard).mockResolvedValue(card())
    render(<PersonSummary userId="u1" title="Нарушитель" />)

    expect(await screen.findByText('Серикова Айгуль')).toBeInTheDocument()
    expect(screen.getByText('Студент · КазНУ')).toBeInTheDocument()
  })

  // Главный вопрос модератора — впервые человек попался или снова. Пустой счётчик
  // должен говорить это словами, а не отсутствием строки: отсутствие читается как
  // «данные не пришли».
  it('говорит «жалоб не было», а не молчит', async () => {
    vi.mocked(fetchPersonCard).mockResolvedValue(card())
    render(<PersonSummary userId="u1" title="Нарушитель" />)

    expect(await screen.findByText('Жалоб на этого человека не было')).toBeInTheDocument()
  })

  it('считает жалобы и отдельно подтверждённые', async () => {
    vi.mocked(fetchPersonCard).mockResolvedValue(card({ complaints: { total: 4, upheld: 2 } }))
    render(<PersonSummary userId="u1" title="Нарушитель" />)

    expect(await screen.findByText('Жалоб на человека: 4, подтверждено 2')).toBeInTheDocument()
  })

  it('отмечает уже заблокированного: повторная блокировка ничего не решает', async () => {
    vi.mocked(fetchPersonCard).mockResolvedValue(card({ isBlocked: true }))
    render(<PersonSummary userId="u1" title="Нарушитель" />)

    expect(await screen.findByText('Доступ заблокирован')).toBeInTheDocument()
  })

  // Карточка вспомогательная: по отказу экран разбора обязан остаться рабочим.
  it('по отказу показывает строку, а не рушит экран', async () => {
    vi.mocked(fetchPersonCard).mockRejectedValue(new Error('нет сети'))
    render(<PersonSummary userId="u1" title="Нарушитель" />)

    expect(await screen.findByText('Карточку человека загрузить не удалось')).toBeInTheDocument()
  })
})
