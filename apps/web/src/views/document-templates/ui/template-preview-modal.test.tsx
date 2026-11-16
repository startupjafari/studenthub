import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../entities/document-template', async (orig) => {
  const actual = await orig<typeof import('../../../entities/document-template')>()
  return { ...actual, downloadDocumentTemplateTest: vi.fn() }
})
vi.mock('../../../shared/lib', async (orig) => {
  const actual = await orig<typeof import('../../../shared/lib')>()
  return { ...actual, saveBlob: vi.fn() }
})
// Сама отрисовка DOCX — дело библиотеки; здесь проверяем, что окно её вызывает и чистит итог.
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(async (_blob: Blob, body: HTMLElement) => {
    body.innerHTML =
      '<div class="docx-wrapper"><section class="docx"><p>Нурланова Айгерим</p>' +
      '<a href="javascript:alert(1)">ссылка</a></section></div>'
  }),
}))

import { downloadDocumentTemplateTest } from '../../../entities/document-template'
import { saveBlob } from '../../../shared/lib'
import { renderAsync } from 'docx-preview'
import { TemplatePreviewModal } from './template-preview-modal'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

beforeAll(() => {
  // jsdom не знает ResizeObserver: окно подгоняет страницу по ширине через него.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => vi.clearAllMocks())

describe('TemplatePreviewModal', () => {
  it('рисует пример выбранной версии, без ссылок, и скачивает тот же файл', async () => {
    const blob = new Blob(['docx'])
    vi.mocked(downloadDocumentTemplateTest).mockResolvedValue({ blob, filename: 'пример.docx' })
    const user = userEvent.setup()
    render(
      <TemplatePreviewModal templateId="t-1" versionId="v-2" version={2} onClose={vi.fn()} />,
      { wrapper },
    )

    expect(screen.getByText('Пример документа · версия 2')).toBeInTheDocument()
    expect(await screen.findByText('Нурланова Айгерим')).toBeInTheDocument()
    expect(downloadDocumentTemplateTest).toHaveBeenCalledWith('t-1', 'v-2')
    expect(vi.mocked(renderAsync).mock.calls[0]?.[3]).toMatchObject({ renderAltChunks: false })
    await waitFor(() => expect(screen.getByText('ссылка')).not.toHaveAttribute('href'))

    await user.click(screen.getByRole('button', { name: 'Скачать DOCX' }))
    expect(saveBlob).toHaveBeenCalledWith(blob, 'пример.docx')
    // Скачивание не формирует документ второй раз.
    expect(downloadDocumentTemplateTest).toHaveBeenCalledTimes(1)
  })

  it('если документ не отрисовался, предлагает скачать его', async () => {
    vi.mocked(downloadDocumentTemplateTest).mockResolvedValue({
      blob: new Blob(['x']),
      filename: 'пример.docx',
    })
    vi.mocked(renderAsync).mockRejectedValueOnce(new Error('broken'))
    render(
      <TemplatePreviewModal templateId="t-1" versionId="v-1" version={1} onClose={vi.fn()} />,
      { wrapper },
    )
    expect(
      await screen.findByText(
        'Не удалось показать документ в браузере. Скачайте его и откройте в Word.',
      ),
    ).toBeInTheDocument()
  })
})
