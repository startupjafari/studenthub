import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../../../entities/document/api/document-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/document/api/document-api')>()
  return {
    ...actual,
    reorderDocumentFiles: vi.fn(),
    removeDocumentFile: vi.fn(),
    replaceDocumentFile: vi.fn(),
    attachDocumentFiles: vi.fn(),
    uploadDocumentFile: vi.fn(),
  }
})

import { toast } from 'sonner'
import {
  removeDocumentFile,
  reorderDocumentFiles,
  replaceDocumentFile,
  uploadDocumentFile,
  type DocumentDto,
} from '../../../entities/document'
import { ConfirmProvider } from '../../../shared/ui'
import { DocumentPagesModal } from './document-pages-modal'

function doc(fileIds: string[]): DocumentDto {
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
    files: fileIds.map((id, i) => ({ id, mime: 'image/jpeg', size: 2048, order: i })),
    fileCount: fileIds.length,
    accessCount: 0,
  }
}

function setup(d: DocumentDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<DocumentPagesModal doc={d} onOpenPage={vi.fn()} onClose={vi.fn()} />, { wrapper })
  return userEvent.setup()
}

afterEach(() => vi.clearAllMocks())

describe('DocumentPagesModal', () => {
  it('«ниже» отправляет на сервер новый порядок всех страниц', async () => {
    vi.mocked(reorderDocumentFiles).mockResolvedValue(doc(['p2', 'p1']))
    const user = setup(doc(['p1', 'p2']))
    await user.click(screen.getByRole('button', { name: 'Страницу 1 ниже' }))
    expect(reorderDocumentFiles).toHaveBeenCalledWith('d1', ['p2', 'p1'])
  })

  it('единственную страницу удалить нельзя — кнопка выключена и есть подсказка', () => {
    setup(doc(['p1']))
    expect(screen.getByRole('button', { name: 'Удалить страницу 1' })).toBeDisabled()
    expect(screen.getByText(/Единственную страницу нельзя удалить/)).toBeInTheDocument()
  })

  it('удаление страницы — после подтверждения', async () => {
    vi.mocked(removeDocumentFile).mockResolvedValue(doc(['p1']))
    const user = setup(doc(['p1', 'p2']))
    await user.click(screen.getByRole('button', { name: 'Удалить страницу 2' }))
    expect(removeDocumentFile).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(removeDocumentFile).toHaveBeenCalledWith('d1', 'p2'))
    expect(await screen.findByText('Страница 1')).toBeInTheDocument()
    expect(screen.queryByText('Страница 2')).not.toBeInTheDocument()
  })

  it('замена: загружает файл и ставит его на место выбранной страницы', async () => {
    vi.mocked(uploadDocumentFile).mockResolvedValue({ id: 'new', mime: 'image/png', size: 10 })
    vi.mocked(replaceDocumentFile).mockResolvedValue(doc(['new', 'p2']))
    const user = setup(doc(['p1', 'p2']))
    await user.click(screen.getByRole('button', { name: 'Заменить страницу 1' }))
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    await user.upload(input, new File(['x'], 'scan.png', { type: 'image/png' }))
    await waitFor(() => expect(replaceDocumentFile).toHaveBeenCalledWith('d1', 'p1', 'new'))
  })

  it('неподходящий тип файла отбивается до загрузки', async () => {
    const user = userEvent.setup({ applyAccept: false })
    setup(doc(['p1', 'p2']))
    await user.click(screen.getByRole('button', { name: 'Заменить страницу 1' }))
    const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    await user.upload(input, new File(['x'], 'a.zip', { type: 'application/zip' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(uploadDocumentFile).not.toHaveBeenCalled()
    expect(replaceDocumentFile).not.toHaveBeenCalled()
  })

  it('документ на проверке (409) — понятная подсказка, а не «Конфликт данных»', async () => {
    vi.mocked(reorderDocumentFiles).mockRejectedValue({ code: 'CONFLICT' })
    const user = setup(doc(['p1', 'p2']))
    await user.click(screen.getByRole('button', { name: 'Страницу 2 выше' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/на проверке/)),
    )
  })
})
