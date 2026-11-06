import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryClearance } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/library/api/library-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/library/api/library-api')>()
  return {
    ...actual,
    fetchClearance: vi.fn(),
    fetchMyClearanceCertificates: vi.fn(),
    issueClearanceCertificate: vi.fn(),
  }
})
vi.mock('../../../shared/lib/download-file', async (orig) => {
  const actual = await orig<typeof import('../../../shared/lib/download-file')>()
  return { ...actual, saveFile: vi.fn() }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { toast } from 'sonner'
import {
  fetchClearance,
  fetchMyClearanceCertificates,
  issueClearanceCertificate,
} from '../../../entities/library'
import { saveFile } from '../../../shared/lib/download-file'
import { ClearanceView } from './clearance-view'

// Справка «задолженностей нет» с кодом проверки (Фаза 21.C4).

const CLEAR: LibraryClearance = {
  clear: true,
  checkedAt: '2026-11-06T10:00:00.000Z',
  reader: { name: 'Сейтова Айгерим', group: 'ИТ-23-1', faculty: 'ИТ', studentCardNumber: '1' },
  university: 'КазНУ',
  loans: [],
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<ClearanceView />, { wrapper })
  return userEvent.setup()
}

afterEach(() => vi.clearAllMocks())

describe('ClearanceView', () => {
  it('без долгов: PDF с кодом скачивается, выданные справки — с кодом и статусом', async () => {
    vi.mocked(fetchClearance).mockResolvedValue(CLEAR)
    vi.mocked(fetchMyClearanceCertificates).mockResolvedValue([
      {
        code: 'K7M3QABC',
        number: 'LIB-2026-ABCDEF',
        issuedAt: '2026-11-06T10:00:00.000Z',
        revokedAt: '2026-11-07T08:00:00.000Z',
        reader: { id: 'stu-1', name: 'Сейтова Айгерим' },
      },
    ])
    const file = { blob: new Blob(['%PDF']), filename: 'clearance.pdf' }
    vi.mocked(issueClearanceCertificate).mockResolvedValue(file)
    const user = setup()

    expect(await screen.findByText('Код K7M3QABC')).toBeInTheDocument()
    expect(screen.getByText('Отозвана')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Проверить/ })).toHaveAttribute(
      'href',
      '/verify/K7M3QABC',
    )

    await user.click(screen.getByRole('button', { name: /Скачать справку/ }))
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(file))
    expect(issueClearanceCertificate).toHaveBeenCalledWith('ru')
    await waitFor(() => expect(fetchMyClearanceCertificates).toHaveBeenCalledTimes(2))
  })

  it('книгу выдали, пока страница открыта: 409 debts — список долгов перечитывается', async () => {
    vi.mocked(fetchClearance).mockResolvedValue(CLEAR)
    vi.mocked(fetchMyClearanceCertificates).mockResolvedValue([])
    vi.mocked(issueClearanceCertificate).mockRejectedValue({
      code: 'CONFLICT',
      message: 'книги',
      details: [{ field: 'debts', message: 'книги' }],
    })
    const user = setup()
    await user.click(await screen.findByRole('button', { name: /Скачать справку/ }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('За вами числятся книги — сначала верните их'),
    )
    expect(fetchClearance).toHaveBeenCalledTimes(2)
    expect(saveFile).not.toHaveBeenCalled()
  })

  it('с долгами кнопки справки нет', async () => {
    vi.mocked(fetchClearance).mockResolvedValue({ ...CLEAR, clear: false, loans: [] })
    vi.mocked(fetchMyClearanceCertificates).mockResolvedValue([])
    setup()
    await screen.findByText(/верните/)
    expect(screen.queryByRole('button', { name: /Скачать справку/ })).not.toBeInTheDocument()
  })
})
