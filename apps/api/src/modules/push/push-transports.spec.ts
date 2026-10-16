import { EventEmitter } from 'node:events'
import { generateKeyPairSync } from 'node:crypto'
import { connect } from 'node:http2'
import { ApnsService } from './apns.service'
import { FcmService } from './fcm.service'

// F-F10: зависший push-провайдер не должен держать отправку (а с ней job и очередь
// уведомлений) бесконечно — у каждого транспорта свой дедлайн.

jest.mock('node:http2', () => ({
  ...jest.requireActual<typeof import('node:http2')>('node:http2'),
  connect: jest.fn(),
}))

type Mock = jest.Mock

class FakeStream extends EventEmitter {
  setEncoding = jest.fn()
  end = jest.fn()
  close = jest.fn()
}

class FakeSession extends EventEmitter {
  closed = false
  destroyed = false
  stream = new FakeStream()
  request = jest.fn(() => this.stream)
  destroy = jest.fn(() => {
    this.destroyed = true
  })
}

function config(env: Record<string, unknown>) {
  return { get: (key: string) => env[key] } as never
}

describe('ApnsService — дедлайн запроса', () => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  const env = {
    APNS_KEY_ID: 'KEY',
    APNS_TEAM_ID: 'TEAM',
    APNS_PRIVATE_KEY: pem,
    APNS_BUNDLE_ID: 'app.studenthub',
    APNS_PRODUCTION: false,
  }

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('APNs молчит — retry по дедлайну, молчащее соединение закрывается', async () => {
    const hung = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(hung)
    const service = new ApnsService(config(env))

    const outcome = service.send('token', { title: 'T', body: 'B' })
    await jest.advanceTimersByTimeAsync(10_000)

    await expect(outcome).resolves.toBe('retry')
    expect(hung.stream.close).toHaveBeenCalled()
    expect(hung.destroy).toHaveBeenCalled()

    // Следующий пуш идёт уже по новому соединению.
    const fresh = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(fresh)
    const next = service.send('token', { title: 'T', body: 'B' })
    fresh.stream.emit('response', { ':status': 200 })
    fresh.stream.emit('end')
    await expect(next).resolves.toBe('delivered')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('поток закрылся без ответа — retry сразу, не по дедлайну', async () => {
    const session = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(session)
    const service = new ApnsService(config(env))

    const outcome = service.send('token', { title: 'T', body: 'B' })
    session.stream.emit('close')

    await expect(outcome).resolves.toBe('retry')
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('FcmService — дедлайн запроса', () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  const env = { FCM_PROJECT_ID: 'proj', FCM_CLIENT_EMAIL: 'sa@proj.iam', FCM_PRIVATE_KEY: pem }
  const realFetch = global.fetch
  let fetchMock: Mock

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as never
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('обмен токена и отправка идут с AbortSignal', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at' }) })
      .mockResolvedValueOnce({ status: 200, text: async () => '{}' })
    const service = new FcmService(config(env))

    await expect(service.send('token', { title: 'T', body: 'B' })).resolves.toBe('delivered')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('таймаут запроса — retry, устройство не выбрасывается', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at' }) })
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'TimeoutError'))
    const service = new FcmService(config(env))

    await expect(service.send('token', { title: 'T', body: 'B' })).resolves.toBe('retry')
  })
})
