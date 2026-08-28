import type { ConfigService } from '@nestjs/config'
import type { OpsNotifier } from '../../../common/monitoring'
import type { EnvVars } from '../../../config/env.schema'
import type { OpsPolicyService } from '../ops-policy.service'
import { PublicPingCheck } from './public-ping.check'

// T-6 (docs/TELEGRAM_BOT.md §2.2): «/health изнутри может отвечать, когда снаружи
// приложение недоступно: упал прокси, протух сертификат, домен не резолвится».

const URL_ = 'https://studenthub.app/health'

function makePolicy() {
  const states = new Map<string, string>()
  return {
    transitioned: jest.fn(async (key: string, state: string, healthy: string) => {
      const previous = states.get(key)
      states.set(key, state)
      return previous === undefined ? state !== healthy : previous !== state
    }),
  }
}

// «Не задано» передаём как null, а не undefined: `setup(undefined)` подставил бы значение
// по умолчанию, и тест проверял бы ровно противоположное тому, ради чего написан.
function setup(url: string | null = URL_) {
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const config = { get: jest.fn(() => url ?? undefined) }
  const check = new PublicPingCheck(
    config as unknown as ConfigService<EnvVars, true>,
    makePolicy() as unknown as OpsPolicyService,
    ops,
  )
  return { check, ops }
}

describe('PublicPingCheck', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  function mockFetch(impl: jest.Mock) {
    global.fetch = impl as unknown as typeof fetch
    return impl
  }

  it('без OPS_PUBLIC_URL не ходит в сеть', async () => {
    const fetchMock = mockFetch(jest.fn())
    const { check } = setup(null)

    await check.run()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('приложение отвечает — канал молчит', async () => {
    mockFetch(jest.fn(async () => ({ status: 200 })))
    const { check, ops } = setup()

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('редирект на канонический домен — норма, а не авария', async () => {
    mockFetch(jest.fn(async () => ({ status: 301 })))
    const { check, ops } = setup()

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('сеть не отвечает — 🔴 с адресом и причиной', async () => {
    mockFetch(jest.fn(async () => Promise.reject(new Error('ENOTFOUND'))))
    const { check, ops } = setup()

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('publicUrlDown', expect.objectContaining({ url: URL_ }))
  })

  it('502 от прокси — тоже недоступность', async () => {
    mockFetch(jest.fn(async () => ({ status: 502 })))
    const { check, ops } = setup()

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('publicUrlDown', { url: URL_, reason: 'HTTP 502' })
  })

  it('восстановление приходит отдельным 🟢, а не тишиной', async () => {
    const fetchMock = mockFetch(jest.fn(async () => ({ status: 502 })))
    const { check, ops } = setup()
    await check.run()

    fetchMock.mockResolvedValueOnce({ status: 200 })
    await check.run()

    expect(ops.emit).toHaveBeenLastCalledWith('publicUrlUp', { url: URL_ })
  })
})
