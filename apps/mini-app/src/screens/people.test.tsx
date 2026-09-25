import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Person } from '../api/people'

vi.mock('../api/people', async (orig) => {
  const actual = await orig<typeof import('../api/people')>()
  return {
    ...actual,
    searchPeople: vi.fn(),
    setBlocked: vi.fn().mockResolvedValue(undefined),
    revokeSessions: vi.fn().mockResolvedValue(undefined),
    // Карточку человека рисует PersonSummary на странице человека; её отказ экран не
    // ломает, поэтому в тестах о доступе она молчит.
    fetchPersonCard: vi.fn().mockRejectedValue(new Error('нет карточки')),
    fetchInvites: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('../telegram/webapp', () => ({
  haptic: { tap: vi.fn(), select: vi.fn(), success: vi.fn() },
  confirmAction: vi.fn().mockResolvedValue(true),
  webApp: () => null,
  isTelegram: () => false,
}))
vi.mock('../telegram/use-telegram', () => ({ useBackButton: vi.fn(), useMainButton: vi.fn() }))

import { confirmAction } from '../telegram/webapp'
import { searchPeople, setBlocked } from '../api/people'
import { PeopleScreen } from './people'

function person(over: Partial<Person> = {}): Person {
  return {
    id: 'u1',
    email: 'aigul@uni.kz',
    firstName: 'Айгуль',
    lastName: 'Серикова',
    role: 'STUDENT',
    isBlocked: false,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/**
 * Доступ меняют НА СТРАНИЦЕ человека, а не в строке списка: решение принимается по
 * человеку, и принимать его надо там, где видно, кто он и попадался ли раньше.
 */
async function openPerson(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /Серикова Айгуль/ }))
}

describe('PeopleScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(confirmAction).mockResolvedValue(true)
    vi.mocked(searchPeople).mockResolvedValue({ items: [person()], total: 1 })
  })

  it('находит человека и показывает его почту', async () => {
    render(<PeopleScreen />)
    expect(await screen.findByText('Серикова Айгуль')).toBeInTheDocument()
    expect(screen.getByText('aigul@uni.kz')).toBeInTheDocument()
  })

  // Список пользователей платформы велик: фильтровать загруженную страницу значило бы
  // искать среди первых двадцати.
  it('ищет на сервере, а не в загруженной странице', async () => {
    render(<PeopleScreen />)
    await screen.findByText('Серикова Айгуль')

    await userEvent.type(screen.getByLabelText(/Фамилия/), 'Серик')

    await waitFor(() => expect(vi.mocked(searchPeople).mock.calls.at(-1)?.[0]).toBe('Серик'))
  })

  it('открывает страницу человека по строке списка', async () => {
    render(<PeopleScreen />)
    await openPerson()

    expect(await screen.findByRole('button', { name: 'Заблокировать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Завершить сессии' })).toBeInTheDocument()
  })

  it('блокирует только после подтверждения', async () => {
    render(<PeopleScreen />)
    await openPerson()

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }))

    // Третьим аргументом уходит код 2FA: блокировка с телефона подтверждается им,
    // разблокировка — нет.
    // Четвёртый аргумент — срок. Не выбран ни один чип = «Навсегда», как было до сроков.
    await waitFor(() => expect(setBlocked).toHaveBeenCalledWith('u1', true, '', undefined))
    expect(confirmAction).toHaveBeenCalled()
  })

  it('не блокирует, если подтверждение отклонили', async () => {
    vi.mocked(confirmAction).mockResolvedValue(false)
    render(<PeopleScreen />)
    await openPerson()

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }))

    expect(setBlocked).not.toHaveBeenCalled()
  })

  /**
   * При фильтре «только заблокированные» перезапрос списка убрал бы разблокированного
   * из выдачи прямо под пальцем — человек не успел бы увидеть, что действие сработало.
   */
  it('после блокировки правит строку списка на месте, не перезапрашивая его', async () => {
    render(<PeopleScreen />)
    await openPerson()
    const callsBefore = vi.mocked(searchPeople).mock.calls.length

    await userEvent.click(await screen.findByRole('button', { name: 'Заблокировать' }))
    expect(await screen.findByRole('button', { name: 'Разблокировать' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Назад' }))

    expect(await screen.findByText('Заблокирован')).toBeInTheDocument()
    expect(vi.mocked(searchPeople).mock.calls.length).toBe(callsBefore)
  })

  it('сообщает, когда никого не нашли', async () => {
    vi.mocked(searchPeople).mockResolvedValue({ items: [], total: 0 })
    render(<PeopleScreen />)
    expect(await screen.findByText('Никого не нашли')).toBeInTheDocument()
  })
})

describe('PeopleScreen — подтверждение блокировки', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(confirmAction).mockResolvedValue(true)
    vi.mocked(searchPeople).mockResolvedValue({ items: [person()], total: 1 })
  })

  it('передаёт введённый код вместе с блокировкой', async () => {
    render(<PeopleScreen />)
    await openPerson()

    await userEvent.type(await screen.findByLabelText(/Код 2FA/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Заблокировать' }))

    await waitFor(() => expect(setBlocked).toHaveBeenCalledWith('u1', true, '123456', undefined))
  })

  // Та же асимметрия, что у техработ: вернуть доступ обязано быть возможно сразу.
  it('разблокировка кода не требует', async () => {
    vi.mocked(searchPeople).mockResolvedValue({ items: [person({ isBlocked: true })], total: 1 })
    render(<PeopleScreen />)
    await openPerson()

    await userEvent.click(await screen.findByRole('button', { name: 'Разблокировать' }))

    await waitFor(() => expect(setBlocked).toHaveBeenCalledWith('u1', false, undefined, undefined))
  })

  // Поле кода и сроки показываются только для блокировки: у заблокированного их нет.
  it('заблокированному не показывает ни кода, ни сроков', async () => {
    vi.mocked(searchPeople).mockResolvedValue({ items: [person({ isBlocked: true })], total: 1 })
    render(<PeopleScreen />)
    await openPerson()

    await screen.findByRole('button', { name: 'Разблокировать' })
    expect(screen.queryByLabelText(/Код 2FA/)).not.toBeInTheDocument()
  })
})
