import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }))

// Сеть глушим: проверяем, ЧТО уходит в перестановку и что видно до ответа сервера.
vi.mock('../../../entities/portfolio/api/portfolio-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/portfolio/api/portfolio-api')>()
  return { ...actual, fetchMyPortfolio: vi.fn(), reorderPortfolio: vi.fn() }
})

import { toast } from 'sonner'
import { fetchMyPortfolio, reorderPortfolio, type PortfolioItem } from '../../../entities/portfolio'
import { ConfirmProvider } from '../../../shared/ui'
import { PortfolioView } from './portfolio-view'

function item(id: string, title: string, order: number): PortfolioItem {
  return {
    id,
    kind: 'PROJECT',
    title,
    organization: null,
    description: null,
    url: null,
    startDate: null,
    endDate: null,
    visibility: 'UNIVERSITY',
    order,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const ITEMS = [item('a', 'Альфа', 0), item('b', 'Бета', 1)]

function setup() {
  vi.mocked(fetchMyPortfolio).mockResolvedValue(ITEMS)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </QueryClientProvider>
  )
  render(<PortfolioView />, { wrapper })
}

const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

async function openMenu(title: string) {
  const user = userEvent.setup()
  const card = screen.getByText(title).closest('[data-slot="card"]') as HTMLElement
  await user.click(within(card).getByRole('button', { name: 'actions' }))
  return user
}

afterEach(() => vi.clearAllMocks())

// E-F24 (follow-up): порядок портфолио меняется с экрана — стрелками в меню карточки.
describe('PortfolioView — перестановка', () => {
  it('«выше» — сразу на экране и все id в новом порядке на сервер', async () => {
    let resolve: (v: PortfolioItem[]) => void = () => {}
    vi.mocked(reorderPortfolio).mockReturnValue(new Promise((r) => (resolve = r)))
    setup()
    expect(await screen.findByText('Бета')).toBeInTheDocument()
    expect(titles()).toEqual(['Альфа', 'Бета'])

    const user = await openMenu('Бета')
    await user.click(await screen.findByRole('menuitem', { name: 'moveUp' }))

    expect(reorderPortfolio).toHaveBeenCalledWith(['b', 'a'])
    // Ответа ещё нет, а порядок уже новый.
    await waitFor(() => expect(titles()).toEqual(['Бета', 'Альфа']))
    resolve([item('b', 'Бета', 0), item('a', 'Альфа', 1)])
    await waitFor(() => expect(titles()).toEqual(['Бета', 'Альфа']))
  })

  it('отказ сервера — порядок откатывается, тост с ошибкой', async () => {
    vi.mocked(reorderPortfolio).mockRejectedValue({ code: 'BAD_REQUEST', message: '' })
    setup()
    expect(await screen.findByText('Альфа')).toBeInTheDocument()

    const user = await openMenu('Альфа')
    await user.click(await screen.findByRole('menuitem', { name: 'moveDown' }))

    expect(reorderPortfolio).toHaveBeenCalledWith(['b', 'a'])
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('BAD_REQUEST'))
    expect(titles()).toEqual(['Альфа', 'Бета'])
  })

  it('край вида — пункт неактивен', async () => {
    setup()
    expect(await screen.findByText('Альфа')).toBeInTheDocument()
    await openMenu('Альфа')
    expect(await screen.findByRole('menuitem', { name: 'moveUp' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
