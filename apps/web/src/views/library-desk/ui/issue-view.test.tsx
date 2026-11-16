import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryReaderSession } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/library/api/library-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/library/api/library-api')>()
  return {
    ...actual,
    lookupReaderRequest: vi.fn(),
    issueLoanRequest: vi.fn(),
    fetchLoans: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  }
})
// Камера в jsdom не нужна: экран проверяем без сканера.
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { issueLoanRequest, lookupReaderRequest } from '../../../entities/library'
import { IssueView } from './issue-view'

// Выдача без телефона (Фаза 21.C5): поиск по номеру билета и обязательная отметка.

const SESSION: LibraryReaderSession = {
  reader: {
    id: 'stu-1',
    firstName: 'Нурлан',
    lastName: 'Оспанов',
    middleName: null,
    avatarUrl: 'https://cdn.example/avatar.webp',
    group: 'ИТ-23-1',
    faculty: 'ФИТ',
    studentCardNumber: '2023-0042',
    academicStatus: null,
    course: 2,
  },
  eligibility: {
    canBorrow: true,
    activeLoans: 0,
    maxActiveLoans: 5,
    overdueLoans: 0,
    lostLoans: 0,
    blockers: [],
  },
  via: 'card',
  ticket: 'ticket-card',
  ticketExpiresAt: '2026-11-06T10:15:00.000Z',
  loans: [],
  defaultDueDate: '2026-11-20',
  maxDueDate: '2027-03-06',
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<IssueView />, { wrapper })
  return userEvent.setup()
}

afterEach(() => vi.clearAllMocks())

describe('IssueView — читатель без телефона', () => {
  it('поиск по номеру билета → выдача только после отметки, отметка уходит на сервер', async () => {
    vi.mocked(lookupReaderRequest).mockResolvedValue(SESSION)
    vi.mocked(issueLoanRequest).mockReturnValue(new Promise(() => undefined))
    const user = setup()

    await user.type(screen.getByPlaceholderText('Номер студенческого билета'), ' 2023-0042 ')
    await user.click(screen.getByRole('button', { name: 'Найти' }))
    await waitFor(() => expect(lookupReaderRequest).toHaveBeenCalled())
    expect(vi.mocked(lookupReaderRequest).mock.calls[0]?.[0]).toBe('2023-0042')

    expect(await screen.findByText(/без скана QR/)).toBeInTheDocument()
    expect(screen.getByText('Без телефона')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Инвентарный номер'), '101')
    const issue = screen.getByRole('button', { name: 'Выдать' })
    // Без отметки выдать нельзя.
    expect(issue).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Читатель без телефона/ }))
    expect(issue).toBeEnabled()
    await user.click(issue)
    await waitFor(() =>
      expect(issueLoanRequest).toHaveBeenCalledWith({
        ticket: 'ticket-card',
        inventoryNumber: '101',
        dueDate: '2026-11-20',
        withoutPhone: true,
      }),
    )
  })

  it('номера нет — понятная ошибка', async () => {
    vi.mocked(lookupReaderRequest).mockRejectedValue({ code: 'NOT_FOUND', message: 'нет' })
    const user = setup()
    await user.type(screen.getByPlaceholderText('Номер студенческого билета'), '0000')
    await user.click(screen.getByRole('button', { name: 'Найти' }))
    expect(
      await screen.findByText('Читатель с таким номером студенческого в вузе не найден'),
    ).toBeInTheDocument()
  })
})
