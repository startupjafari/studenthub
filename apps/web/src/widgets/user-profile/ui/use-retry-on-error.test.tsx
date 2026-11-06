import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { MAX_RETRY_ATTEMPTS, retryDelay, useRetryOnError } from './use-retry-on-error'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

interface State {
  isError: boolean
  isFetching: boolean
  error: unknown
}

const serverError = { code: 'INTERNAL_ERROR', message: '' }

/** Хук поверх «запроса», состояние которого тест переключает сам, как это делал бы React Query. */
function setup(initial: State) {
  const refetch = vi.fn(async () => undefined)
  const hook = renderHook((state: State) => useRetryOnError({ ...state, refetch }, 'Ошибка'), {
    initialProps: initial,
  })
  return { ...hook, refetch }
}

/** Один повтор: пауза истекла → запрос ушёл → вернулся с той же ошибкой. */
function failAgain(hook: ReturnType<typeof setup>, attempt: number, error: unknown = serverError) {
  act(() => {
    vi.advanceTimersByTime(retryDelay(attempt))
  })
  hook.rerender({ isError: true, isFetching: true, error })
  hook.rerender({ isError: true, isFetching: false, error })
}

describe('useRetryOnError (E-F25)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(toast.error).mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('паузы растут вдвое и упираются в минуту', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelay)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ])
  })

  it('сбой сервера: один тост на весь эпизод, повторы с растущей паузой', () => {
    const hook = setup({ isError: true, isFetching: false, error: serverError })
    expect(toast.error).toHaveBeenCalledTimes(1)

    // До конца первой паузы повтора нет.
    act(() => {
      vi.advanceTimersByTime(retryDelay(0) - 1)
    })
    expect(hook.refetch).not.toHaveBeenCalled()

    failAgain(hook, 0)
    expect(hook.refetch).toHaveBeenCalledTimes(1)
    // Вторая пауза длиннее первой: через 5 с повтора ещё нет.
    act(() => {
      vi.advanceTimersByTime(retryDelay(0))
    })
    expect(hook.refetch).toHaveBeenCalledTimes(1)
    failAgain(hook, 1)
    expect(hook.refetch).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(hook.result.current.failed).toBe(false)
  })

  it('попытки исчерпаны — повторы прекращаются, вкладка показывает ошибку', () => {
    const hook = setup({ isError: true, isFetching: false, error: serverError })
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) failAgain(hook, attempt)
    expect(hook.refetch).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS)
    expect(hook.result.current.failed).toBe(true)

    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(hook.refetch).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('ошибку, которую повтор не исправит (403/404), не повторяем и не тостим', () => {
    const hook = setup({
      isError: true,
      isFetching: false,
      error: { code: 'FORBIDDEN', message: '' },
    })
    expect(hook.result.current.failed).toBe(true)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(hook.refetch).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('429 повторяется с паузой, а не каждые 5 секунд вечно', () => {
    const hook = setup({ isError: true, isFetching: false, error: { code: 'RATE_LIMIT' } })
    expect(hook.result.current.failed).toBe(false)
    failAgain(hook, 0, { code: 'RATE_LIMIT' })
    expect(hook.refetch).toHaveBeenCalledTimes(1)
  })

  it('ручной повтор начинает отсчёт заново; успех закрывает эпизод', () => {
    const hook = setup({ isError: true, isFetching: false, error: { code: 'NOT_FOUND' } })
    expect(hook.result.current.failed).toBe(true)

    act(() => hook.result.current.retry())
    expect(hook.refetch).toHaveBeenCalledTimes(1)
    hook.rerender({ isError: true, isFetching: true, error: { code: 'NOT_FOUND' } })
    hook.rerender({ isError: false, isFetching: false, error: null })
    expect(hook.result.current.failed).toBe(false)

    // Новая ошибка после успеха — новый эпизод со своим тостом.
    hook.rerender({ isError: true, isFetching: false, error: serverError })
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
