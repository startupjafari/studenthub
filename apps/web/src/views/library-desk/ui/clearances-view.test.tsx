import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClearanceCertificateItem } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/library/api/library-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/library/api/library-api')>()
  return { ...actual, fetchClearances: vi.fn(), revokeClearanceRequest: vi.fn() }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { fetchClearances, revokeClearanceRequest } from '../../../entities/library'
import { TooltipProvider } from '../../../shared/ui'
import { ClearancesView } from './clearances-view'

// Справки «задолженностей нет» у библиотекаря (Фаза 21.C4).

const ACTIVE: ClearanceCertificateItem = {
  code: 'K7M3QABC',
  number: 'LIB-2026-ABCDEF',
  issuedAt: '2026-11-06T10:00:00.000Z',
  revokedAt: null,
  reader: { id: 'stu-1', name: 'Сейтова Айгерим' },
}
const REVOKED: ClearanceCertificateItem = {
  ...ACTIVE,
  code: 'Z9Y8X7W6',
  revokedAt: '2026-11-07T08:00:00.000Z',
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<ClearancesView />, { wrapper })
  return userEvent.setup()
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  vi.mocked(fetchClearances).mockResolvedValue({ items: [ACTIVE, REVOKED], total: 2 })
})
afterEach(() => vi.clearAllMocks())

describe('ClearancesView', () => {
  it('показывает код, читателя и статус; по умолчанию — действующие', async () => {
    setup()
    expect(await screen.findByText('K7M3QABC')).toBeInTheDocument()
    expect(fetchClearances).toHaveBeenCalledWith({ status: 'active', page: 1, limit: 20 })
    expect(screen.getByText('Действует')).toBeInTheDocument()
    expect(screen.getByText(/^Отозвана/)).toBeInTheDocument()
    // Отозвать можно только действующую.
    expect(screen.getAllByRole('button', { name: 'Отозвать' })).toHaveLength(1)
  })

  it('отзыв — с причиной, затем список перечитывается', async () => {
    vi.mocked(revokeClearanceRequest).mockResolvedValue({
      ...ACTIVE,
      revokedAt: '2026-11-07T09:00:00.000Z',
    })
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'Отозвать' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/K7M3QABC/)).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox'), 'Книга не вернулась')
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    await waitFor(() =>
      expect(revokeClearanceRequest).toHaveBeenCalledWith('K7M3QABC', 'Книга не вернулась'),
    )
    await waitFor(() => expect(fetchClearances).toHaveBeenCalledTimes(2))
  })
})
