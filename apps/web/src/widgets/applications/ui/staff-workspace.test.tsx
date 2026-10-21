import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// next-intl → ключ как есть (у t есть и has — им пользуется лента событий); тосты глушим.
vi.mock('next-intl', () => {
  const t = Object.assign((k: string) => k, { has: () => false })
  return { useTranslations: () => t, useLocale: () => 'ru' }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../../../entities/application-service/api/application-service-api', async (orig) => {
  const actual =
    await orig<typeof import('../../../entities/application-service/api/application-service-api')>()
  return {
    ...actual,
    fetchApplication: vi.fn(),
    fetchApplicationAssignees: vi.fn().mockResolvedValue([]),
    fetchApplicationDocumentUrl: vi.fn().mockResolvedValue('https://minio/page'),
  }
})

import {
  fetchApplication,
  fetchApplicationDocumentUrl,
  type ApplicationDetail,
  type ApplicationDocumentItem,
} from '../../../entities/application-service'
import { StaffWorkspaceModal } from './staff-workspace'

function doc(over: Partial<ApplicationDocumentItem> = {}): ApplicationDocumentItem {
  return {
    id: 'ad1',
    requirementId: 'r1',
    documentId: 'doc1',
    source: 'STORAGE',
    status: 'PENDING',
    reviewComment: null,
    snapshotTitle: 'Паспорт',
    requirement: {
      id: 'r1',
      titleRu: 'Паспорт',
      titleKk: 'Паспорт',
      titleEn: 'Passport',
      required: true,
    },
    ...over,
  }
}

function app(documents: ApplicationDocumentItem[]): ApplicationDetail {
  return {
    id: 'a1',
    number: 'SH-2026-000001',
    status: 'IN_REVIEW',
    deliveryType: 'ELECTRONIC',
    formData: {},
    studentId: 'stud',
    facultyId: 'fac',
    universityId: 'uni',
    assignedToId: null,
    submittedAt: '2026-10-01T10:00:00.000Z',
    dueAt: null,
    readyAt: null,
    issuedAt: null,
    cancelledAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    service: {
      id: 's1',
      code: 'ref',
      nameRu: 'Справка',
      nameKk: 'Анықтама',
      nameEn: 'Certificate',
      slaHours: 24,
    },
    rejectionReason: null,
    pickupLocation: null,
    pickupInstructions: null,
    events: [],
    documents,
    results: [],
  }
}

function renderWorkspace() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <StaffWorkspaceModal id="a1" onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

// Регрессия D-F06: обработчик видел только первую страницу документа.
describe('StaffWorkspaceModal — страницы документа', () => {
  beforeEach(() => {
    vi.mocked(fetchApplicationDocumentUrl).mockClear()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('у многостраничного документа — кнопка на каждую страницу, ссылка по fileId', async () => {
    vi.mocked(fetchApplication).mockResolvedValue(
      app([
        doc({
          files: [
            { id: 'f1', mime: 'image/jpeg', order: 0 },
            { id: 'f2', mime: 'image/jpeg', order: 1 },
          ],
        }),
      ]),
    )
    renderWorkspace()
    const pages = await screen.findAllByRole('button', { name: 'viewDocPage' })
    expect(pages).toHaveLength(2)

    await userEvent.click(pages[1]!)
    await waitFor(() => expect(fetchApplicationDocumentUrl).toHaveBeenCalledWith('a1', 'ad1', 'f2'))
  })

  it('одностраничный документ — одна кнопка «Просмотреть»', async () => {
    vi.mocked(fetchApplication).mockResolvedValue(
      app([doc({ files: [{ id: 'f1', mime: 'application/pdf', order: 0 }] })]),
    )
    renderWorkspace()
    const view = await screen.findByRole('button', { name: 'viewDoc' })
    expect(screen.queryByRole('button', { name: 'viewDocPage' })).not.toBeInTheDocument()

    await userEvent.click(view)
    await waitFor(() => expect(fetchApplicationDocumentUrl).toHaveBeenCalledWith('a1', 'ad1', 'f1'))
  })
})
