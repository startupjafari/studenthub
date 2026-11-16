import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sentry, state } = vi.hoisted(() => ({
  sentry: { captureException: vi.fn() },
  state: { enabled: true },
}))
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('./sentry-options', () => ({
  get sentryEnabled() {
    return state.enabled
  },
}))

import { captureException } from './capture-exception'

describe('captureException', () => {
  beforeEach(() => sentry.captureException.mockClear())

  it('при включённом трекере отдаёт ошибку SDK вместе с подсказкой', async () => {
    state.enabled = true
    const error = new Error('boom')
    captureException(error, { tags: { source: 'error-boundary' } })
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledTimes(1))
    expect(sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { source: 'error-boundary' },
    })
  })

  it('без DSN SDK не трогает', async () => {
    state.enabled = false
    captureException(new Error('boom'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sentry.captureException).not.toHaveBeenCalled()
  })
})
