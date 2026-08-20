import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException }))
// StatusScreen тянет next/navigation и next-intl; проверяем контракт boundary, а не вёрстку.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }))

import { ErrorScreen } from './error-screen'

// Ф13.8: смысл компонента — ошибка не должна умирать в браузере пользователя.
describe('ErrorScreen', () => {
  beforeEach(() => captureException.mockClear())

  it('отправляет ошибку в Sentry при монтировании', () => {
    render(<ErrorScreen error={new Error('boom')} reset={vi.fn()} />)

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('прикладывает digest Next — по нему клиентское событие сшивается с серверным', () => {
    const error = Object.assign(new Error('boom'), { digest: '2749142058' })

    render(<ErrorScreen error={error} reset={vi.fn()} />)

    expect(captureException.mock.calls[0]?.[1]).toEqual({
      tags: { source: 'error-boundary', next_digest: '2749142058' },
    })
  })

  it('показывает пользователю экран с возможностью повторить', () => {
    render(<ErrorScreen error={new Error('boom')} reset={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'error' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument()
  })
})
