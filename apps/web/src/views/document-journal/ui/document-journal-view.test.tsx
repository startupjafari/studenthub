import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentJournalItem } from '@studenthub/shared-schemas'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/document/api/document-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/document/api/document-api')>()
  return { ...actual, fetchDocumentJournal: vi.fn() }
})
// Каталог типов вуза ходит в сеть — здесь он не предмет проверки.
vi.mock('../../../entities/document-type', () => ({
  useDocumentTypeCatalog: () => ({ labelOf: (id: string) => (id === 'PASSPORT' ? 'Паспорт' : id) }),
}))

import { fetchDocumentJournal } from '../../../entities/document'
import { TooltipProvider } from '../../../shared/ui'
import { DocumentJournalView } from './document-journal-view'

const ROW: DocumentJournalItem = {
  id: 'e1',
  createdAt: '2026-10-20T10:00:00.000Z',
  action: 'VIEW',
  actor: { id: 'dean-1', name: 'Ахметова Дана', role: 'DEAN' },
  owner: { id: 'stu-1', name: 'Абишева Асем' },
  document: { id: 'd1', category: 'PERSONAL', type: 'PASSPORT', deleted: false },
  via: 'GRANT',
  granteeType: 'DEPARTMENT',
  request: null,
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
  render(<DocumentJournalView />, { wrapper })
  return userEvent.setup()
}

beforeEach(() => {
  // jsdom не знает ResizeObserver, а таблица меряет им полосу прокрутки.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => vi.clearAllMocks())

describe('DocumentJournalView', () => {
  it('строка: кто, чей документ, тип и категория, действие, через какой доступ', async () => {
    vi.mocked(fetchDocumentJournal).mockResolvedValue({ items: [ROW], total: 1 })
    setup()
    expect(await screen.findByText('Ахметова Дана')).toBeInTheDocument()
    expect(screen.getByText('Абишева Асем')).toBeInTheDocument()
    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.getByText('Личные')).toBeInTheDocument()
    expect(screen.getByText('Просмотр')).toBeInTheDocument()
    expect(screen.getByText('Доступ: деканат')).toBeInTheDocument()
  })

  it('клик по имени сужает журнал до этого человека', async () => {
    vi.mocked(fetchDocumentJournal).mockResolvedValue({ items: [ROW], total: 1 })
    const user = setup()
    await user.click(await screen.findByText('Абишева Асем'))
    await waitFor(() =>
      expect(fetchDocumentJournal).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 'stu-1', page: 1 }),
      ),
    )
    expect(screen.getByText('Человек: Абишева Асем')).toBeInTheDocument()
  })

  it('пустой журнал — пояснение, а не пустая таблица', async () => {
    vi.mocked(fetchDocumentJournal).mockResolvedValue({ items: [], total: 0 })
    setup()
    expect(await screen.findByText('Записей пока нет')).toBeInTheDocument()
  })
})
