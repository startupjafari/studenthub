import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ru from '../../../../messages/ru.json'

vi.mock('../../../entities/vacancy/api/vacancy-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/vacancy/api/vacancy-api')>()
  return { ...actual, createVacancy: vi.fn(), updateVacancy: vi.fn() }
})

import { updateVacancy, type EmployerVacancy } from '../../../entities/vacancy'
import { VacancyFormModal } from './vacancy-form-modal'

const WARNING = ru.EmployerVacancies.reReviewWarning

function vacancy(over: Partial<EmployerVacancy> = {}): EmployerVacancy {
  return {
    id: 'v-1',
    title: 'Стажёр-аналитик',
    description: 'Работа с данными, отчёты и дашборды для команды продукта.',
    employmentType: 'INTERNSHIP',
    workFormat: 'HYBRID',
    experienceLevel: 'NO_EXPERIENCE',
    city: 'Алматы',
    salaryMin: 200000,
    salaryMax: 300000,
    salaryCurrency: 'KZT',
    skills: ['SQL', 'Excel'],
    languages: [],
    deadline: '2026-12-01T00:00:00.000Z',
    publishedAt: '2026-10-01T00:00:00.000Z',
    company: { id: 'co-1', name: 'Компания', slug: 'co', logoUrl: null, city: null },
    status: 'PUBLISHED',
    views: 10,
    createdAt: '2026-10-01T00:00:00.000Z',
    reviews: [{ status: 'APPROVED', reason: null, university: { id: 'u-1', name: 'Вуз' } }],
    ...over,
  }
}

function setup(v: EmployerVacancy | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  return render(<VacancyFormModal vacancy={v} onClose={() => {}} />, { wrapper })
}

beforeEach(() => {
  vi.mocked(updateVacancy).mockReset().mockResolvedValue(undefined)
})

describe('VacancyFormModal — правка одобренной вакансии (D-F12)', () => {
  it('предупреждает о повторной модерации, только когда меняется прочитанное вузом', () => {
    setup(vacancy())
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(ru.EmployerVacancies.fieldTitle), {
      target: { value: 'Младший аналитик' },
    })
    expect(screen.getByText(WARNING)).toBeInTheDocument()
  })

  it('у вакансии без одобрений предупреждения нет', () => {
    setup(vacancy({ reviews: [], status: 'DRAFT' }))
    fireEvent.change(screen.getByLabelText(ru.EmployerVacancies.fieldTitle), {
      target: { value: 'Младший аналитик' },
    })
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('на сервер уходят только изменённые поля', async () => {
    setup(vacancy())
    fireEvent.change(screen.getByLabelText(ru.EmployerVacancies.fieldSkills), {
      target: { value: 'SQL,Excel' },
    })
    fireEvent.change(screen.getByLabelText(ru.EmployerVacancies.fieldTitle), {
      target: { value: 'Младший аналитик' },
    })
    fireEvent.click(screen.getByRole('button', { name: ru.EmployerVacancies.save }))

    // «SQL,Excel» и «SQL, Excel» — те же навыки: в запрос уходит только название.
    await waitFor(() =>
      expect(updateVacancy).toHaveBeenCalledWith('v-1', { title: 'Младший аналитик' }),
    )
  })
})
