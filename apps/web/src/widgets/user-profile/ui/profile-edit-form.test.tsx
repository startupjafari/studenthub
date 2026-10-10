import type { ReactNode } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

// next-intl → ключ как есть: проверяем payload, а не подписи.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

// Справочник специальностей уходит в сеть — глушим, форме он тут не нужен.
vi.mock('../../../entities/specialty', async (orig) => {
  const actual = await orig<typeof import('../../../entities/specialty')>()
  return { ...actual, fetchSpecialties: vi.fn().mockResolvedValue([]) }
})

import type { MeResponse } from '../../../shared/api'
import { PROFILE_EDIT_FORM_ID, ProfileEditForm } from './profile-edit-form'
import type { Section } from './sections'

const ME = {
  firstName: 'Айдана',
  lastName: 'Сериковна',
  middleName: null,
  headline: null,
  showEmail: false,
  showPhone: false,
  gender: null,
} as unknown as MeResponse

// Одна секция с одним полем — ровно тем, которое чинится.
const SECTIONS = [
  { key: 'personal', title: 'personal', fields: [{ key: 'gender', type: 'gender' }] },
] as unknown as Section[]

// Radix Select требует ResizeObserver, которого в jsdom нет. Заглушка — как в
// table.test.tsx: измерять здесь нечего, форму отправляем напрямую.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('ProfileEditForm — пол не обязателен', () => {
  // Пустая строка в enum MALE|FEMALE|OTHER не входит: сервер отвечал VALIDATION_ERROR
  // на ВЕСЬ профиль, и пока пол не выбран, не сохранялось вообще ничего.
  it('невыбранный пол уходит как null, а не пустой строкой', () => {
    const onSave = vi.fn()
    const { container } = render(<ProfileEditForm me={ME} sections={SECTIONS} onSave={onSave} />, {
      wrapper,
    })

    fireEvent.submit(container.querySelector(`#${PROFILE_EDIT_FORM_ID}`)!)

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = (onSave.mock.calls.at(0)?.[0] ?? {}) as Record<string, unknown>
    expect(payload.gender).toBeNull()
    expect(payload.gender).not.toBe('')
    // Остальное по-прежнему уезжает — ради этого правка и делалась.
    expect(payload.firstName).toBe('Айдана')
  })
})
