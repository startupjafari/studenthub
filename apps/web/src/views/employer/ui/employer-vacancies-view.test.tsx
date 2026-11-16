import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../../../entities/vacancy/api/vacancy-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/vacancy/api/vacancy-api')>()
  return { ...actual, fetchMyVacancies: vi.fn(), deleteVacancy: vi.fn() }
})

import { deleteVacancy, fetchMyVacancies, type EmployerVacancy } from '../../../entities/vacancy'
import { ConfirmProvider } from '../../../shared/ui'
import { EmployerVacanciesView } from './employer-vacancies-view'

const T = ru.EmployerVacancies

function vacancy(over: Partial<EmployerVacancy>): EmployerVacancy {
  return {
    id: 'v-1',
    title: 'Стажёр-аналитик',
    description: 'Работа с данными, отчёты и дашборды для команды продукта.',
    employmentType: 'INTERNSHIP',
    workFormat: 'HYBRID',
    experienceLevel: 'NO_EXPERIENCE',
    city: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    skills: [],
    languages: [],
    deadline: null,
    publishedAt: null,
    company: { id: 'co-1', name: 'Компания', slug: 'co', logoUrl: null, city: null },
    status: 'DRAFT',
    views: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    reviews: [],
    ...over,
  }
}

function setup(rows: EmployerVacancy[]) {
  vi.mocked(fetchMyVacancies).mockResolvedValue({ items: rows, total: rows.length })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<EmployerVacanciesView />, { wrapper })
}

beforeEach(() => {
  vi.mocked(deleteVacancy).mockReset().mockResolvedValue(undefined)
})

describe('EmployerVacanciesView — удаление черновика (21.D3)', () => {
  it('«Удалить» есть только у черновика', async () => {
    setup([
      vacancy({ id: 'v-draft', title: 'Аналитик данных' }),
      vacancy({ id: 'v-pub', title: 'Опубликованная', status: 'PUBLISHED' }),
      vacancy({ id: 'v-closed', title: 'Закрытая', status: 'CLOSED' }),
    ])
    const draftRow = (await screen.findByText('Аналитик данных')).closest('li') as HTMLElement
    expect(within(draftRow).getByRole('button', { name: T.delete })).toBeInTheDocument()
    for (const title of ['Опубликованная', 'Закрытая']) {
      const row = screen.getByText(title).closest('li') as HTMLElement
      expect(within(row).queryByRole('button', { name: T.delete })).not.toBeInTheDocument()
    }
  })

  it('удаляет только после подтверждения', async () => {
    setup([vacancy({ id: 'v-draft', title: 'Аналитик данных' })])
    fireEvent.click(await screen.findByRole('button', { name: T.delete }))
    expect(await screen.findByText(T.deleteConfirm)).toBeInTheDocument()
    expect(deleteVacancy).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: T.delete }))
    await waitFor(() => expect(deleteVacancy).toHaveBeenCalledWith('v-draft'))
  })
})
