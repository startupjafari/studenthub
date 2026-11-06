import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@studenthub/shared-types'
import ru from '../../../../messages/ru.json'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('../../../shared/store', () => ({
  useAppSelector: (pick: (s: { auth: { role: Role } }) => unknown) =>
    pick({ auth: { role: Role.STUDENT } }),
}))
// Справочник КАТО ходит в сеть — здесь он не предмет проверки.
vi.mock('../../../entities/kato', () => ({
  useKatoNames: () => ({ nameOf: () => null }),
}))
vi.mock('../../../entities/vacancy/api/vacancy-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/vacancy/api/vacancy-api')>()
  return { ...actual, fetchVacancy: vi.fn() }
})
vi.mock('../../../entities/career-application/api/career-application-api', async (orig) => {
  const actual =
    await orig<typeof import('../../../entities/career-application/api/career-application-api')>()
  return { ...actual, fetchMyApplications: vi.fn(), applyToVacancy: vi.fn() }
})
vi.mock('../../../entities/career-profile/api/career-profile-api', async (orig) => {
  const actual =
    await orig<typeof import('../../../entities/career-profile/api/career-profile-api')>()
  return { ...actual, fetchMyCareerProfile: vi.fn() }
})

import { fetchVacancy, type Vacancy } from '../../../entities/vacancy'
import { applyToVacancy, fetchMyApplications } from '../../../entities/career-application'
import { fetchMyCareerProfile, type CareerProfile } from '../../../entities/career-profile'
import { VacancyDetailModal } from './vacancy-detail-modal'

const T = ru.Vacancies
const VACANCY_ID = '00000000-0000-4000-8000-000000000001'

const vacancy: Vacancy = {
  id: VACANCY_ID,
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
  publishedAt: '2026-10-01T00:00:00.000Z',
  company: { id: 'co-1', name: 'Компания', slug: 'co', logoUrl: null, city: null },
  match: null,
}

function profile(over: Partial<CareerProfile>): CareerProfile {
  return { visibility: 'HIDDEN', profileGrants: [], ...over } as CareerProfile
}

function setup(p: CareerProfile) {
  vi.mocked(fetchMyCareerProfile).mockResolvedValue(p)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<VacancyDetailModal vacancy={vacancy} universityId={null} onClose={() => {}} />, {
    wrapper,
  })
}

beforeEach(() => {
  // jsdom не знает ResizeObserver, а чекбокс Radix меряет им свой размер.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  vi.mocked(fetchVacancy).mockResolvedValue(vacancy)
  vi.mocked(fetchMyApplications).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(applyToVacancy).mockReset().mockResolvedValue({ id: 'a-1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VacancyDetailModal — скрытый профиль и отклик (21.D1)', () => {
  it('скрытый профиль: предупреждение, и без галочки отклик профиль не открывает', async () => {
    setup(profile({}))
    expect(await screen.findByText(T.profileHiddenTitle)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: T.apply }))
    await waitFor(() => expect(applyToVacancy).toHaveBeenCalled())
    expect(vi.mocked(applyToVacancy).mock.calls[0]?.[0]).toMatchObject({ shareProfile: false })
  })

  it('галочка открывает профиль этой компании вместе с откликом', async () => {
    setup(profile({}))
    fireEvent.click(await screen.findByRole('checkbox', { name: T.shareProfile }))
    fireEvent.click(screen.getByRole('button', { name: T.apply }))
    await waitFor(() => expect(applyToVacancy).toHaveBeenCalled())
    expect(vi.mocked(applyToVacancy).mock.calls[0]?.[0]).toMatchObject({
      vacancyId: VACANCY_ID,
      shareProfile: true,
    })
  })

  it('профиль, открытый работодателям, — без предупреждения и галочки', async () => {
    setup(profile({ visibility: 'EMPLOYERS' }))
    expect(await screen.findByText(T.profileVisibleNote)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('уже открытый этой компании профиль — без галочки', async () => {
    setup(
      profile({
        profileGrants: [{ companyId: 'co-1', companyName: 'Компания', grantedAt: '' }],
      }),
    )
    expect(await screen.findByText(T.profileSharedNote)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
