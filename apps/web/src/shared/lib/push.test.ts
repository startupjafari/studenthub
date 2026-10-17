import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({ api: { post: vi.fn().mockResolvedValue({}) } }))
vi.mock('./platform', () => ({
  isIosDevice: vi.fn(() => false),
  isStandalonePwa: vi.fn(() => false),
}))

import { api } from '../api'
import { isIosDevice, isStandalonePwa } from './platform'
import { pushAvailability, subscribeToPush, unsubscribeFromPush } from './push'

// Клиентская подписка на Web Push: в jsdom нет ни service worker, ни PushManager, ни
// Notification — подставляем их сами и проверяем, что уходит в браузер и на бэкенд.

// base64url c «-», «_» и без выравнивания «=» — именно так выглядит настоящий VAPID-ключ.
const VAPID = '-_-_BA'
const VAPID_BYTES = [251, 255, 191, 4]

interface FakeSubscription {
  endpoint: string
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeSubscription(endpoint = 'https://push.example/sub-1'): FakeSubscription {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

function installPushApi(options: {
  permission?: NotificationPermission
  existing?: FakeSubscription | null
}) {
  const created = fakeSubscription('https://push.example/new')
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(options.existing ?? null),
    subscribe: vi.fn().mockResolvedValue(created),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  })
  vi.stubGlobal('PushManager', function PushManager() {})
  const requestPermission = vi.fn().mockResolvedValue(options.permission ?? 'granted')
  vi.stubGlobal('Notification', { requestPermission })
  return { pushManager, requestPermission, created }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', VAPID)
  vi.mocked(api.post).mockClear()
  vi.mocked(isIosDevice).mockReturnValue(false)
  vi.mocked(isStandalonePwa).mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('pushAvailability', () => {
  it('iPhone во вкладке Safari — «сначала установите», даже если API на месте', () => {
    installPushApi({})
    vi.mocked(isIosDevice).mockReturnValue(true)
    expect(pushAvailability()).toBe('ios-needs-install')
  })

  it('iPhone с главного экрана и с API — доступно', () => {
    installPushApi({})
    vi.mocked(isIosDevice).mockReturnValue(true)
    vi.mocked(isStandalonePwa).mockReturnValue(true)
    expect(pushAvailability()).toBe('ok')
  })

  it('браузер без service worker и PushManager — не поддерживается', () => {
    expect(pushAvailability()).toBe('unsupported')
  })
})

describe('subscribeToPush', () => {
  it('без VAPID-ключа не подписывает и разрешение не спрашивает', async () => {
    const { requestPermission } = installPushApi({})
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '')

    await expect(subscribeToPush()).resolves.toBe(false)
    expect(requestPermission).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('отказ в разрешении — ни подписки у браузера, ни записи на бэкенде', async () => {
    const { pushManager } = installPushApi({ permission: 'denied' })

    await expect(subscribeToPush()).resolves.toBe(false)
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('новая подписка: видимые уведомления, ключ base64url раскодирован в байты', async () => {
    const { pushManager } = installPushApi({})

    await expect(subscribeToPush()).resolves.toBe(true)

    const [opts] = pushManager.subscribe.mock.calls[0] as [
      { userVisibleOnly: boolean; applicationServerKey: Uint8Array },
    ]
    expect(opts.userVisibleOnly).toBe(true)
    expect(Array.from(opts.applicationServerKey)).toEqual(VAPID_BYTES)
    expect(api.post).toHaveBeenCalledWith('/push/subscribe', {
      endpoint: 'https://push.example/new',
      keys: { p256dh: 'p256', auth: 'auth' },
    })
  })

  it('уже есть подписка — второй не заводит, но привязывает её на бэкенде', async () => {
    const existing = fakeSubscription('https://push.example/old')
    const { pushManager } = installPushApi({ existing })

    await expect(subscribeToPush()).resolves.toBe(true)

    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith(
      '/push/subscribe',
      expect.objectContaining({ endpoint: 'https://push.example/old' }),
    )
  })
})

describe('unsubscribeFromPush', () => {
  it('подписки нет — на бэкенд не ходит', async () => {
    installPushApi({ existing: null })

    await unsubscribeFromPush()

    expect(api.post).not.toHaveBeenCalled()
  })

  it('снимает подписку и на бэкенде, и у push-сервиса браузера', async () => {
    const existing = fakeSubscription()
    installPushApi({ existing })

    await unsubscribeFromPush()

    expect(api.post).toHaveBeenCalledWith('/push/unsubscribe', {
      endpoint: 'https://push.example/sub-1',
    })
    expect(existing.unsubscribe).toHaveBeenCalled()
  })

  it('сбой бэкенда не мешает отписать браузер', async () => {
    const existing = fakeSubscription()
    installPushApi({ existing })
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'))

    await expect(unsubscribeFromPush()).resolves.toBeUndefined()
    expect(existing.unsubscribe).toHaveBeenCalled()
  })

  it('push не поддерживается — ничего не делает', async () => {
    await expect(unsubscribeFromPush()).resolves.toBeUndefined()
    expect(api.post).not.toHaveBeenCalled()
  })
})
