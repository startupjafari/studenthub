import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Role } from '@studenthub/shared-types'

// next-intl → ключ как есть; тосты глушим (Toaster в тесте не смонтирован).
vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ru',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// Удаление бьёт по сети — глушим запрос, проверяем ПЕРЕДАННОЕ ТЕЛО.
vi.mock('../../../entities/user/api/user-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/user/api/user-api')>()
  return { ...actual, deleteAccountRequest: vi.fn() }
})

import { deleteAccountRequest } from '../../../entities/user'
import type { MeResponse } from '../../../shared/api'
import { DangerSection } from './account-settings-panels'

const me: MeResponse = {
  id: 'u1',
  email: 'ivan@uni.kz',
  firstName: 'Иван',
  lastName: 'Петров',
  avatarUrl: null,
  role: Role.STUDENT,
  showEmail: false,
  universityId: 'un1',
  facultyId: null,
  groupId: null,
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const deleteMut = vi.mocked(deleteAccountRequest)
// Кнопка в карточке и кнопка подтверждения в окне подписаны одинаково — берём последнюю.
const confirmButton = () => screen.getAllByRole('button', { name: /deleteAccount/ }).at(-1)!

beforeEach(() => {
  deleteMut.mockReset()
})

// A-F13: необратимое удаление шло без пароля — хватало открытой вкладки.
describe('DangerSection — удаление с повторной аутентификацией', () => {
  it('без пароля подтвердить нельзя; с паролем уходит пароль без кода', async () => {
    const user = userEvent.setup()
    deleteMut.mockReturnValue(new Promise(() => undefined))
    render(<DangerSection me={me} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    expect(confirmButton()).toBeDisabled()
    expect(screen.queryByLabelText('deleteCodeLabel')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('currentPassword'), 'Secret123')
    await user.click(confirmButton())

    await waitFor(() => expect(deleteMut).toHaveBeenCalled())
    expect(deleteMut.mock.calls[0]?.[0]).toEqual({ password: 'Secret123' })
  })

  it('с 2FA нужен ещё и код — он уходит вместе с паролем', async () => {
    const user = userEvent.setup()
    deleteMut.mockReturnValue(new Promise(() => undefined))
    render(<DangerSection me={{ ...me, twoFactorEnabled: true }} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await user.type(screen.getByLabelText('currentPassword'), 'Secret123')
    expect(confirmButton()).toBeDisabled()
    await user.type(screen.getByLabelText('deleteCodeLabel'), ' 123456 ')
    await user.click(confirmButton())

    await waitFor(() => expect(deleteMut).toHaveBeenCalled())
    expect(deleteMut.mock.calls[0]?.[0]).toEqual({ password: 'Secret123', code: '123456' })
  })

  it('неверный пароль — сообщение в том же окне, введённый пароль не теряется', async () => {
    const user = userEvent.setup()
    // shared/api/instance.ts отклоняет промис ТЕЛОМ ошибки { code, message }.
    deleteMut.mockRejectedValue({ code: 'BAD_REQUEST', message: 'Неверный текущий пароль' })
    render(<DangerSection me={me} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await user.type(screen.getByLabelText('currentPassword'), 'wrong')
    await user.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('deleteWrongPassword'))
    expect(screen.getByLabelText('currentPassword')).toHaveValue('wrong')
  })

  it('последний администратор платформы — понятный отказ', async () => {
    const user = userEvent.setup()
    deleteMut.mockRejectedValue({ code: 'CONFLICT', message: 'последний' })
    render(<DangerSection me={{ ...me, role: Role.PLATFORM_ADMIN }} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await user.type(screen.getByLabelText('currentPassword'), 'Secret123')
    await user.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('deleteLastAdmin'))
  })
})
