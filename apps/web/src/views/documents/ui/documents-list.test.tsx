import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../../../entities/document/api/document-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/document/api/document-api')>()
  return { ...actual, fetchDocuments: vi.fn() }
})
// Каталог типов вуза ходит в сеть — здесь он не предмет проверки.
vi.mock('../../../entities/document-type', () => ({
  useDocumentTypeCatalog: () => ({ labelOf: (id: string) => id }),
}))
vi.mock('../../../shared/store', () => ({ useAppSelector: () => null }))

import { fetchDocuments, type DocumentDto } from '../../../entities/document'
import { ConfirmProvider, TooltipProvider } from '../../../shared/ui'
import { DocumentsList } from './documents-list'

function doc(over: Partial<DocumentDto>): DocumentDto {
  return {
    id: 'd1',
    category: 'PERSONAL',
    type: 'ID_CARD',
    title: 'Удостоверение',
    numberMasked: null,
    issuedBy: null,
    issuedAt: null,
    expiresAt: null,
    comment: null,
    status: 'UPLOADED',
    rejectionReason: null,
    issuedByUniversity: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    fileCount: 0,
    accessCount: 0,
    ...over,
  }
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<DocumentsList preset="active" />, { wrapper })
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

// Статусы проверки (15.3) приходят от сервера — список обязан их показать владельцу.
describe('DocumentsList — статусы проверки', () => {
  it('«Требует замены» с причиной отклонения, «На проверке», «Принят»', async () => {
    vi.mocked(fetchDocuments).mockResolvedValue([
      doc({ id: 'a', title: 'Паспорт', status: 'NEEDS_REPLACEMENT', rejectionReason: 'Размыто' }),
      doc({ id: 'b', title: 'Диплом', status: 'IN_REVIEW' }),
      doc({ id: 'c', title: 'Аттестат', status: 'ACCEPTED' }),
    ])
    setup()
    expect(await screen.findByText('Требует замены')).toBeInTheDocument()
    expect(screen.getByText('Размыто')).toBeInTheDocument()
    expect(screen.getByText('На проверке')).toBeInTheDocument()
    expect(screen.getByText('Принят')).toBeInTheDocument()
  })
})
