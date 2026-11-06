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
  useFormatter: () => ({ dateTime: () => '20 нояб.' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// Удаление бьёт по сети — глушим запрос, проверяем ПЕРЕДАННОЕ ТЕЛО.
vi.mock('../../../entities/user/api/user-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/user/api/user-api')>()
  return { ...actual, deleteAccountRequest: vi.fn(), fetchAccountDeletionCheck: vi.fn() }
})

import { deleteAccountRequest, fetchAccountDeletionCheck } from '../../../entities/user'
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
const checkMock = vi.mocked(fetchAccountDeletionCheck)
const canDelete = { canDelete: true, blockers: [], libraryDebts: [] }
// Кнопка в карточке и кнопка подтверждения в окне подписаны одинаково — берём последнюю.
const confirmButton = () => screen.getAllByRole('button', { name: /deleteAccount/ }).at(-1)!

beforeEach(() => {
  deleteMut.mockReset()
  checkMock.mockReset()
  checkMock.mockResolvedValue(canDelete)
})

// A-F13: необратимое удаление шло без пароля — хватало открытой вкладки.
describe('DangerSection — удаление с повторной аутентификацией', () => {
  it('без пароля подтвердить нельзя; с паролем уходит пароль без кода', async () => {
    const user = userEvent.setup()
    deleteMut.mockReturnValue(new Promise(() => undefined))
    render(<DangerSection me={me} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await screen.findByLabelText('currentPassword')
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
    await user.type(await screen.findByLabelText('currentPassword'), 'Secret123')
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
    await user.type(await screen.findByLabelText('currentPassword'), 'wrong')
    await user.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('deleteWrongPassword'))
    expect(screen.getByLabelText('currentPassword')).toHaveValue('wrong')
  })

  it('последний администратор платформы — понятный отказ', async () => {
    const user = userEvent.setup()
    deleteMut.mockRejectedValue({ code: 'CONFLICT', message: 'последний' })
    render(<DangerSection me={{ ...me, role: Role.PLATFORM_ADMIN }} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await user.type(await screen.findByLabelText('currentPassword'), 'Secret123')
    await user.click(confirmButton())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('deleteLastAdmin'))
  })

  // Фаза 21.C1: книги библиотеки на руках — объяснение и список до ввода пароля.
  it('книги на руках: список книг вместо формы, удалить нельзя', async () => {
    const user = userEvent.setup()
    checkMock.mockResolvedValue({
      canDelete: false,
      blockers: ['libraryDebts'],
      libraryDebts: [
        {
          loanId: 'l1',
          status: 'OPEN',
          bookTitle: 'Война и мир',
          inventoryNumber: '0012',
          dueDate: '2026-11-20',
          overdue: true,
        },
        {
          loanId: 'l2',
          status: 'LOST',
          bookTitle: 'Идиот',
          inventoryNumber: '0013',
          dueDate: '2026-10-01',
          overdue: false,
        },
      ],
    })
    render(<DangerSection me={me} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    expect(await screen.findByText('deleteLibraryTitle')).toBeInTheDocument()
    expect(screen.getByText('deleteLibraryDesc')).toBeInTheDocument()
    expect(screen.getByText(/loanLine · overdue/)).toBeInTheDocument()
    expect(screen.getByText('lostLine')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /deleteLibraryMyBooks/ })).toHaveAttribute(
      'href',
      '/my-books',
    )
    expect(screen.queryByLabelText('currentPassword')).not.toBeInTheDocument()
    // В окне кнопки удаления нет (карточка под окном скрыта от доступности).
    expect(screen.queryByRole('button', { name: /deleteAccount/ })).not.toBeInTheDocument()
  })

  it('книгу выдали, пока окно было открыто: 409 — окно перечитывает проверку', async () => {
    const user = userEvent.setup()
    deleteMut.mockRejectedValue({ code: 'LIBRARY_DEBTS_OPEN', message: 'книги' })
    render(<DangerSection me={me} />, { wrapper })

    await user.click(screen.getByRole('button', { name: /deleteAccount/ }))
    await user.type(await screen.findByLabelText('currentPassword'), 'Secret123')
    checkMock.mockResolvedValue({
      canDelete: false,
      blockers: ['libraryDebts'],
      libraryDebts: [
        {
          loanId: 'l1',
          status: 'OPEN',
          bookTitle: 'Война и мир',
          inventoryNumber: '0012',
          dueDate: '2026-11-20',
          overdue: false,
        },
      ],
    })
    await user.click(confirmButton())

    expect(await screen.findByText('deleteLibraryTitle')).toBeInTheDocument()
    expect(checkMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
