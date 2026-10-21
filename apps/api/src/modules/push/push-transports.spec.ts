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

// Ответы провайдеров на уровне сервиса: «устройства нет» → gone (строку чистят),
// разрыв и сбой → retry (устройство остаётся).
describe('ApnsService — ответы APNs', () => {
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

  it('410 Unregistered — gone, дедлайн снят', async () => {
    jest.useFakeTimers()
    try {
      const session = new FakeSession()
      ;(connect as Mock).mockReturnValueOnce(session)
      const service = new ApnsService(config(env))

      const outcome = service.send('token', { title: 'T', body: 'B' })
      session.stream.emit('response', { ':status': 410 })
      session.stream.emit('data', JSON.stringify({ reason: 'Unregistered' }))
      session.stream.emit('end')

      await expect(outcome).resolves.toBe('gone')
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('400 BadDeviceToken — тоже gone, а прочий отказ (429) — retry', async () => {
    const service = new ApnsService(config(env))

    const bad = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(bad)
    const first = service.send('token', { title: 'T', body: 'B' })
    bad.stream.emit('response', { ':status': 400 })
    bad.stream.emit('data', JSON.stringify({ reason: 'BadDeviceToken' }))
    bad.stream.emit('end')
    await expect(first).resolves.toBe('gone')

    // Соединение живо — второй пуш идёт по нему же.
    bad.stream = new FakeStream()
    const second = service.send('token', { title: 'T', body: 'B' })
    bad.stream.emit('response', { ':status': 429 })
    bad.stream.emit('data', JSON.stringify({ reason: 'TooManyRequests' }))
    bad.stream.emit('end')
    await expect(second).resolves.toBe('retry')
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('ошибка потока — retry, и следующий пуш открывает новое соединение', async () => {
    const broken = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(broken)
    const service = new ApnsService(config(env))

    const first = service.send('token', { title: 'T', body: 'B' })
    broken.stream.emit('error', new Error('ECONNRESET'))
    await expect(first).resolves.toBe('retry')

    const fresh = new FakeSession()
    ;(connect as Mock).mockReturnValueOnce(fresh)
    const next = service.send('token', { title: 'T', body: 'B' })
    fresh.stream.emit('response', { ':status': 200 })
    fresh.stream.emit('end')
    await expect(next).resolves.toBe('delivered')
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('провайдерский токен выписывается один раз, а не на каждый пуш', async () => {
    const session = new FakeSession()
    // Одно соединение на оба пуша: сессия жива, второй раз connect не зовётся.
    ;(connect as Mock).mockReturnValueOnce(session)
    const service = new ApnsService(config(env))

    for (let i = 0; i < 2; i++) {
      session.stream = new FakeStream()
      const outcome = service.send('token', { title: 'T', body: 'B' })
      session.stream.emit('response', { ':status': 200 })
      session.stream.emit('end')
      await outcome
    }

    const auth = session.request.mock.calls.map(
      (call) => (call as unknown as [Record<string, string>])[0].authorization,
    )
    expect(auth).toHaveLength(2)
    expect(auth[0]).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(auth[1]).toBe(auth[0])
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('без ключей — disabled, соединение не открывается', async () => {
    const service = new ApnsService(config({ ...env, APNS_PRIVATE_KEY: undefined }))

    await expect(service.send('token', { title: 'T', body: 'B' })).resolves.toBe('disabled')
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('FcmService — ответы FCM', () => {
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()
  const env = { FCM_PROJECT_ID: 'proj', FCM_CLIENT_EMAIL: 'sa@proj.iam', FCM_PRIVATE_KEY: pem }
  const realFetch = global.fetch
  let fetchMock: Mock
  const token = { ok: true, json: async () => ({ access_token: 'at' }) }
  const unregistered = JSON.stringify({
    error: {
      status: 'NOT_FOUND',
      details: [
        {
          '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
          errorCode: 'UNREGISTERED',
        },
      ],
    },
  })

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as never
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('UNREGISTERED — gone', async () => {
    fetchMock
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce({ status: 404, text: async () => unregistered })
    const service = new FcmService(config(env))

    await expect(service.send('token', { title: 'T', body: 'B' })).resolves.toBe('gone')
  })

  it('OAuth-токен кэшируется: второй пуш без повторного обмена', async () => {
    fetchMock
      .mockResolvedValueOnce(token)
      .mockResolvedValue({ status: 200, text: async () => '{}' })
    const service = new FcmService(config(env))

    await service.send('t1', { title: 'T', body: 'B' })
    await service.send('t2', { title: 'T', body: 'B' })

    const urls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls.filter((u) => u.includes('oauth2'))).toHaveLength(1)
    expect(urls.filter((u) => u.includes('messages:send'))).toHaveLength(2)
  })

  it('401 — retry, а токен выписывается заново при следующей отправке', async () => {
    fetchMock
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce({ status: 401, text: async () => '{}' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at-2' }) })
      .mockResolvedValueOnce({ status: 200, text: async () => '{}' })
    const service = new FcmService(config(env))

    await expect(service.send('t1', { title: 'T', body: 'B' })).resolves.toBe('retry')
    await expect(service.send('t1', { title: 'T', body: 'B' })).resolves.toBe('delivered')

    const lastSend = fetchMock.mock.calls[3] as [string, RequestInit]
    expect((lastSend[1].headers as Record<string, string>).authorization).toBe('Bearer at-2')
  })

  it('отказ обмена токена — retry, до отправки дело не доходит', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 })
    const service = new FcmService(config(env))

    await expect(service.send('t1', { title: 'T', body: 'B' })).resolves.toBe('retry')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('без ключей — disabled, в сеть не ходит', async () => {
    const service = new FcmService(config({ ...env, FCM_PRIVATE_KEY: undefined }))

    await expect(service.send('t1', { title: 'T', body: 'B' })).resolves.toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
