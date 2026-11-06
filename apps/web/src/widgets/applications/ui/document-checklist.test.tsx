import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import type { ApplicationDocumentItem } from '../../../entities/application-service'
import { DocumentChecklist } from './document-checklist'

const requirement = {
  id: 'r1',
  documentType: null,
  titleRu: 'Удостоверение',
  titleKk: 'Куәлік',
  titleEn: 'ID card',
  required: true,
}

function attached(status: ApplicationDocumentItem['status']): ApplicationDocumentItem {
  return {
    id: 'ad1',
    requirementId: 'r1',
    documentId: 'doc1',
    source: 'STORAGE',
    status,
    reviewComment: null,
    snapshotTitle: 'Удостоверение личности',
    requirement: { ...requirement },
  }
}

function renderChecklist(doc: ApplicationDocumentItem) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <DocumentChecklist
        appId="a1"
        requirements={[requirement]}
        documents={[doc]}
        editable
        locale="ru"
        onChanged={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

// Заявка ждёт исправления: принятый сотрудником документ сервер убрать не даёт (400), его
// можно только заменить — кнопка «Убрать» у него не показывается.
describe('DocumentChecklist — «Убрать»', () => {
  it('у принятого документа кнопки нет, «Заменить» остаётся', () => {
    renderChecklist(attached('ACCEPTED'))
    expect(screen.queryByRole('button', { name: 'removeDoc' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'replaceDoc' })).toBeInTheDocument()
  })

  it('у документа на проверке кнопка есть', () => {
    renderChecklist(attached('PENDING'))
    expect(screen.getByRole('button', { name: 'removeDoc' })).toBeInTheDocument()
  })
})
