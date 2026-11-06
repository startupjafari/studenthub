import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@studenthub/shared-types'
import ru from '../../../../messages/ru.json'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))
vi.mock('../../../shared/session', () => ({ establishSession: vi.fn() }))
vi.mock('../../../entities/company/api/company-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/company/api/company-api')>()
  return { ...actual, previewCompanyInvite: vi.fn(), acceptCompanyInvite: vi.fn() }
})

import { acceptCompanyInvite, previewCompanyInvite } from '../../../entities/company'
import { establishSession } from '../../../shared/session'
import { EmployerJoinView } from './employer-join-view'

const T = ru.Employer
const TOKEN = 'invite-token-invite-token-invite-token'

// Интерцептор API отдаёт ошибку уже телом `{ code, message }` (shared/api) — так и мокаем.
const apiError = (code: string) => ({ code, message: code })

function setup(token = TOKEN) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="ru" messages={ru}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
  render(<EmployerJoinView token={token} />, { wrapper })
}

beforeEach(() => {
  replace.mockReset()
  vi.mocked(previewCompanyInvite).mockReset().mockResolvedValue({
    companyName: 'ТОО Прогресс',
    email: 'c•••@company.kz',
    expiresAt: '2026-11-08T12:00:00.000Z',
  })
  vi.mocked(acceptCompanyInvite).mockReset().mockResolvedValue('access-token')
  vi.mocked(establishSession).mockReset().mockResolvedValue(Role.EMPLOYER)
})

describe('EmployerJoinView — приём приглашения в компанию (21.D2)', () => {
  it('показывает компанию и адрес под маской; регистрирует и ведёт в кабинет', async () => {
    setup()
    expect(
      await screen.findByText(T.joinTitle.replace('{company}', 'ТОО Прогресс')),
    ).toBeInTheDocument()
    expect(screen.getByText(/c•••@company\.kz/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(T.fieldFirstName), { target: { value: 'Айгерим' } })
    fireEvent.change(screen.getByLabelText(T.fieldLastName), { target: { value: 'Нурланова' } })
    fireEvent.change(screen.getByLabelText(T.fieldPassword), { target: { value: 'Passw0rd!' } })
    fireEvent.click(screen.getByRole('button', { name: T.joinSubmit }))

    await waitFor(() =>
      expect(acceptCompanyInvite).toHaveBeenCalledWith({
        token: TOKEN,
        firstName: 'Айгерим',
        lastName: 'Нурланова',
        password: 'Passw0rd!',
      }),
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/employer'))
  })

  it('использованная ссылка — объяснение кодом ошибки, без формы', async () => {
    vi.mocked(previewCompanyInvite).mockRejectedValue(apiError('INVITE_USED'))
    setup()
    expect(await screen.findByText(T.joinFailTitle)).toBeInTheDocument()
    expect(screen.getByText(ru.Errors.INVITE_USED)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: T.joinSubmit })).not.toBeInTheDocument()
  })

  it('без токена в ссылке — сразу объяснение, без запроса', async () => {
    setup('')
    expect(await screen.findByText(T.joinFailTitle)).toBeInTheDocument()
    expect(previewCompanyInvite).not.toHaveBeenCalled()
  })
})
