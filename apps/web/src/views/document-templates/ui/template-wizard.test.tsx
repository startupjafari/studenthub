import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../../entities/document-template', async (orig) => {
  const actual = await orig<typeof import('../../../entities/document-template')>()
  return { ...actual, createDocumentTemplate: vi.fn() }
})

import { createDocumentTemplate } from '../../../entities/document-template'
import { TemplateWizard } from './template-wizard'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

// jsdom не умеет прокрутку: мастер держит текущий шаг на виду через scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.clearAllMocks())

describe('TemplateWizard', () => {
  it('после создания шаблона к форме создания вернуться нельзя — второго черновика не будет', async () => {
    vi.mocked(createDocumentTemplate).mockResolvedValue({
      id: 't-1',
      title: 'Справка',
      versions: [],
    } as never)
    const user = userEvent.setup()
    render(<TemplateWizard onClose={vi.fn()} />, { wrapper })

    await user.type(screen.getByLabelText('Название шаблона'), 'Справка')
    await user.click(screen.getByRole('button', { name: 'Создать и продолжить' }))

    expect(await screen.findByText(/Оформление документа остаётся вашим/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Назад' })).not.toBeInTheDocument()
    expect(createDocumentTemplate).toHaveBeenCalledTimes(1)

    // Дальше «Назад» есть — он ведёт на подготовку, а не на создание.
    await user.click(screen.getByRole('button', { name: /Далее/ }))
    await user.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.getByText(/Оформление документа остаётся вашим/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Название шаблона')).not.toBeInTheDocument()
  })
})
