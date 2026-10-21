import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// axios подменён: первый create() — основной инстанс `api` (нужен его перехватчик ответов),
// второй — «сырой» клиент refresh.
const h = vi.hoisted(() => {
  const state = {
    created: 0,
    rejected: null as ((error: unknown) => Promise<unknown>) | null,
  }
  const refreshPost = vi.fn()
  const apiCall = vi.fn()
  const dispatch = vi.fn()
  const create = vi.fn(() => {
    state.created += 1
    if (state.created === 1) {
      return Object.assign((config: unknown) => apiCall(config), {
        interceptors: {
          request: { use: vi.fn() },
          response: {
            use: vi.fn((_ok: unknown, rejected: (error: unknown) => Promise<unknown>) => {
              state.rejected = rejected
            }),
          },
        },
      })
    }
    return { post: refreshPost }
  })
  return { state, refreshPost, apiCall, dispatch, create }
})

vi.mock('axios', () => ({ default: { create: h.create }, AxiosError: class extends Error {} }))
vi.mock('../store/store', () => ({
  store: { dispatch: h.dispatch, getState: () => ({ auth: { accessToken: 'old' } }) },
}))
vi.mock('../store/auth-slice', () => ({
  clearAuth: () => ({ type: 'auth/clearAuth' }),
  setAccessToken: (token: string) => ({ type: 'auth/setAccessToken', payload: token }),
}))

import { refreshAccessToken } from './instance'

const ok = (accessToken: string) => ({ data: { success: true, data: { accessToken } } })
const failure = (status: number, code: string) => ({
  response: { status, headers: {}, data: { success: false, error: { code, message: code } } },
})
// Истёкший access-токен у обычного запроса — повод для refresh.
const expired = () => ({
  config: { url: '/chats', headers: { Authorization: 'Bearer old' } },
  response: { status: 401, data: { success: false, error: { code: 'TOKEN_EXPIRED' } } },
})
const clearedAuth = () =>
  h.dispatch.mock.calls.some(([action]) => (action as { type: string }).type === 'auth/clearAuth')

describe('refresh под лимитом запросов (429)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.refreshPost.mockReset()
    h.apiCall.mockReset()
    h.dispatch.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('429 повторяется с выдержкой, и обмен в итоге проходит', async () => {
    h.refreshPost
      .mockRejectedValueOnce(failure(429, 'RATE_LIMIT'))
      .mockResolvedValueOnce(ok('fresh'))

    const token = refreshAccessToken()
    await vi.runAllTimersAsync()

    await expect(token).resolves.toBe('fresh')
    expect(h.refreshPost).toHaveBeenCalledTimes(2)
  })

  it('429 после всех повторов — запрос падает, но сессия не сбрасывается', async () => {
    h.refreshPost.mockRejectedValue(failure(429, 'RATE_LIMIT'))

    const result = h.state.rejected!(expired())
    const settled = expect(result).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    await vi.runAllTimersAsync()
    await settled

    // Первая попытка и три повтора.
    expect(h.refreshPost).toHaveBeenCalledTimes(4)
    expect(clearedAuth()).toBe(false)
    expect(h.apiCall).not.toHaveBeenCalled()
  })

  it('отказ в сессии (401) — без повторов, сессия сбрасывается', async () => {
    h.refreshPost.mockRejectedValue(failure(401, 'UNAUTHORIZED'))
    // Уже на /login — переход не нужен (jsdom навигацию не умеет и шумит в консоль).
    window.history.replaceState(null, '', '/login')

    const result = h.state.rejected!(expired())
    const settled = expect(result).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
    await vi.runAllTimersAsync()
    await settled

    expect(h.refreshPost).toHaveBeenCalledTimes(1)
    expect(clearedAuth()).toBe(true)
  })

  it('после удачного обмена исходный запрос повторяется с новым токеном', async () => {
    h.refreshPost.mockResolvedValue(ok('fresh'))
    h.apiCall.mockResolvedValue({ data: 'ok' })

    await expect(h.state.rejected!(expired())).resolves.toEqual({ data: 'ok' })
    expect(h.apiCall).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer fresh' } }),
    )
  })
})

// A-F30: вкладки делят одну refresh-cookie — обмен идёт под межвкладочной блокировкой.
describe('refresh под межвкладочной блокировкой (Web Locks)', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'locks')

  beforeEach(() => {
    h.refreshPost.mockReset()
    h.dispatch.mockReset()
  })

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'locks', original)
    else Reflect.deleteProperty(navigator, 'locks')
  })

  function stubLocks(request: (...args: unknown[]) => Promise<unknown>) {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
  }

  it('обмен идёт внутри блокировки sh-refresh', async () => {
    const held: string[] = []
    const request = vi.fn(async (name: string, _options: unknown, fn: () => Promise<unknown>) => {
      held.push(name)
      return fn()
    })
    stubLocks(request as never)
    h.refreshPost.mockImplementation(async () => {
      // Запрос уходит, когда блокировка уже взята.
      expect(held).toEqual(['sh-refresh'])
      return ok('locked')
    })

    await expect(refreshAccessToken()).resolves.toBe('locked')
    expect(request).toHaveBeenCalledWith('sh-refresh', expect.any(Object), expect.any(Function))
  })

  it('соседняя вкладка держит блокировку слишком долго — обмен идёт без очереди', async () => {
    stubLocks(async () => {
      throw new DOMException('timeout', 'TimeoutError')
    })
    h.refreshPost.mockResolvedValue(ok('unlocked'))

    await expect(refreshAccessToken()).resolves.toBe('unlocked')
    expect(h.refreshPost).toHaveBeenCalledTimes(1)
  })

  it('отказ сервера внутри блокировки доходит до вызывающего как есть', async () => {
    stubLocks(async (_name, _options, fn) => (fn as () => Promise<unknown>)())
    h.refreshPost.mockRejectedValue(failure(401, 'UNAUTHORIZED'))

    await expect(refreshAccessToken()).rejects.toMatchObject({ response: { status: 401 } })
  })
})
