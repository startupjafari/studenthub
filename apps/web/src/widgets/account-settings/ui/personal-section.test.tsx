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

// Мутации бьют по сети — глушим запросы, проверяем ПЕРЕДАННЫЕ ТЕЛА.
vi.mock('../../../entities/user/api/user-api', async (orig) => {
  const actual = await orig<typeof import('../../../entities/user/api/user-api')>()
  return { ...actual, updateUsernameRequest: vi.fn(), updateProfileRequest: vi.fn() }
})

import { updateProfileRequest, updateUsernameRequest } from '../../../entities/user'
import type { MeResponse } from '../../../shared/api'
import { PersonalSection } from './account-settings-panels'

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

const nameMut = vi.mocked(updateUsernameRequest)
const profileMut = vi.mocked(updateProfileRequest)
const save = () => screen.getByRole('button', { name: /saveChanges/ })

beforeEach(() => {
  nameMut.mockReset()
  profileMut.mockReset()
  nameMut.mockResolvedValue(me)
  profileMut.mockResolvedValue(me)
})

describe('PersonalSection — имя пользователя', () => {
  it('поле стоит в «Личных данных» рядом с ФИО', () => {
    render(<PersonalSection me={{ ...me, username: 'ivan_petrov' }} />, { wrapper })

    expect(screen.getByLabelText('usernameLabel')).toHaveValue('ivan_petrov')
    expect(screen.getByLabelText('lastName')).toHaveValue('Петров')
  })

  it('у аккаунта без имени — подсказка про вход только по email', () => {
    render(<PersonalSection me={me} />, { wrapper })

    expect(screen.getByLabelText('usernameLabel')).toHaveValue('')
    expect(screen.getByText('usernameEmptyHint')).toBeInTheDocument()
  })

  it('недопустимые символы не уходят на сервер', async () => {
    const user = userEvent.setup()
    render(<PersonalSection me={me} />, { wrapper })

    await user.type(screen.getByLabelText('usernameLabel'), 'Иван Петров!')
    await user.click(save())

    await waitFor(() => expect(screen.getByLabelText('usernameLabel')).toBeInvalid())
    expect(nameMut).not.toHaveBeenCalled()
    expect(profileMut).not.toHaveBeenCalled()
  })

  it('одна кнопка сохраняет и имя, и профиль; имя — в нижнем регистре', async () => {
    const user = userEvent.setup()
    render(<PersonalSection me={me} />, { wrapper })

    await user.type(screen.getByLabelText('usernameLabel'), 'Ivan_Petrov')
    await user.click(save())

    await waitFor(() => expect(nameMut).toHaveBeenCalled())
    expect(nameMut.mock.calls[0]?.[0]).toEqual({ username: 'ivan_petrov' })
    // Профиль уходит без username: у него отдельный эндпоинт.
    await waitFor(() => expect(profileMut).toHaveBeenCalled())
    expect(profileMut.mock.calls[0]?.[0]).not.toHaveProperty('username')
  })

  it('нетронутое имя не дёргает свой эндпоинт', async () => {
    const user = userEvent.setup()
    render(<PersonalSection me={{ ...me, username: 'ivan_petrov' }} />, { wrapper })

    await user.clear(screen.getByLabelText('lastName'))
    await user.type(screen.getByLabelText('lastName'), 'Сидоров')
    await user.click(save())

    await waitFor(() => expect(profileMut).toHaveBeenCalled())
    expect(nameMut).not.toHaveBeenCalled()
  })

  it('занятое имя показывается под полем и не сохраняет профиль', async () => {
    const user = userEvent.setup()
    // shared/api/instance.ts отклоняет промис ТЕЛОМ ошибки { code, message }.
    nameMut.mockRejectedValue({ code: 'USERNAME_TAKEN', message: 'занято' })
    render(<PersonalSection me={me} />, { wrapper })

    await user.type(screen.getByLabelText('usernameLabel'), 'taken_name')
    await user.click(save())

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('USERNAME_TAKEN'))
    expect(profileMut).not.toHaveBeenCalled()
  })

  it('ошибка занятого имени гаснет при правке поля', async () => {
    const user = userEvent.setup()
    nameMut.mockRejectedValue({ code: 'USERNAME_TAKEN', message: 'занято' })
    render(<PersonalSection me={me} />, { wrapper })

    const field = screen.getByLabelText('usernameLabel')
    await user.type(field, 'taken_name')
    await user.click(save())
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    await user.type(field, '2')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
