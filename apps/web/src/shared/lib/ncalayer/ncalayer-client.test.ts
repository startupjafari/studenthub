import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NcaLayerError,
  ncaLayerLocale,
  openNcaLayer,
  signChallengeWithNcaLayer,
  type NcaLayerOptions,
  type NcaLayerSocket,
} from './ncalayer-client'

// Фейковый NCALayer: тест сам решает, когда сокет «подключился», что ответить и когда
// оборвать соединение. Настоящий WebSocket в jsdom к 127.0.0.1:13579 не нужен.
class FakeSocket implements NcaLayerSocket {
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  readonly sent: unknown[] = []
  closed = false

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {
    this.closed = true
  }

  /** NCALayer принял соединение и поздоровался. */
  greet(version = '1.4'): void {
    this.onopen?.({})
    this.reply({ result: { version } })
  }

  reply(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  /** Соединение не установлено: так браузер сообщает о незапущенном NCALayer. */
  refuse(): void {
    this.onerror?.({})
    this.onclose?.({})
  }
}

let socket: FakeSocket | null = null
const sockets: FakeSocket[] = []

function options(extra: Partial<NcaLayerOptions> = {}): NcaLayerOptions {
  return {
    createSocket: (url) => {
      socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    localAccessState: () => Promise.resolve(null),
    ...extra,
  }
}

function current(): FakeSocket {
  if (!socket) throw new Error('сокет не создан')
  return socket
}

/** Дать промису подключения дойти до createSocket. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function connected(extra: Partial<NcaLayerOptions> = {}) {
  const pending = openNcaLayer(options(extra))
  await flush()
  current().greet()
  return pending
}

afterEach(() => {
  // Незакрытая сессия держала бы глобальный замок «одна операция за раз» между тестами.
  for (const s of sockets) s.onclose?.({})
  sockets.length = 0
  socket = null
  vi.useRealTimers()
})

describe('подключение к NCALayer', () => {
  it('ждёт приветствия и отдаёт версию; адрес — локальный wss', async () => {
    const session = await connected()
    expect(session.version).toBe('1.4')
    expect(current().url).toBe('wss://127.0.0.1:13579')
    session.close()
    expect(current().closed).toBe(true)
  })

  it('отказ в соединении — not-running', async () => {
    const pending = openNcaLayer(options())
    await flush()
    current().refuse()
    await expect(pending).rejects.toMatchObject({ kind: 'not-running' })
  })

  it('браузер запретил доступ к локальным адресам — blocked, а не «не запущен»', async () => {
    const pending = openNcaLayer(options({ localAccessState: () => Promise.resolve('denied') }))
    await flush()
    current().refuse()
    await expect(pending).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('молчание дольше таймаута — not-running, сокет закрыт', async () => {
    vi.useFakeTimers()
    const pending = openNcaLayer(options({ connectTimeoutMs: 5_000 }))
    const assertion = expect(pending).rejects.toMatchObject({ kind: 'not-running' })
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(current().closed).toBe(true)
  })

  it('на порту ответил не NCALayer — failed', async () => {
    const pending = openNcaLayer(options())
    await flush()
    current().reply({ hello: 'world' })
    await expect(pending).rejects.toMatchObject({ kind: 'failed' })
  })

  it('пока идёт операция, вторая не начинается (busy); после закрытия — можно', async () => {
    const first = await connected()
    await expect(openNcaLayer(options())).rejects.toMatchObject({ kind: 'busy' })
    first.close()
    const second = await connected()
    expect(second.version).toBe('1.4')
    second.close()
  })

  it('отмена до приветствия — cancelled', async () => {
    const controller = new AbortController()
    const pending = openNcaLayer(options({ signal: controller.signal }))
    await flush()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
    expect(current().closed).toBe(true)
  })
})

describe('подпись ключом аутентификации', () => {
  it('шлёт запрос модуля basics: открепленная CMS над байтами nonce, ключ AUTH', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'kz')
    current().reply({ status: true, body: { result: ['MIIcms=='] } })
    await expect(signed).resolves.toBe('MIIcms==')

    expect(current().sent).toEqual([
      {
        module: 'kz.gov.pki.knca.basics',
        method: 'sign',
        args: expect.objectContaining({
          format: 'cms',
          data: 'bm9uY2U=',
          signingParams: { decode: true, encapsulate: false, digested: false },
          signerParams: { extKeyUsageOids: [], chain: [] },
          locale: 'kk',
        }),
      },
    ])
    session.close()
  })

  it('подпись строкой, а не массивом, тоже принимается', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'ru')
    current().reply({ status: true, body: { result: 'MIIsingle' } })
    await expect(signed).resolves.toBe('MIIsingle')
    session.close()
  })

  it('окно закрыто без выбора ключа (пустой body) — cancelled', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'ru')
    current().reply({ status: true, body: {} })
    await expect(signed).rejects.toMatchObject({ kind: 'cancelled' })
    session.close()
  })

  it('ошибка NCALayer (status: false) — failed', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'ru')
    current().reply({ status: false, code: '500', message: 'wrong password' })
    await expect(signed).rejects.toMatchObject({ kind: 'failed' })
    session.close()
  })

  it('ответ без status — старый NCALayer без модуля basics (outdated)', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'ru')
    current().reply({ code: '500', message: 'Module not found' })
    await expect(signed).rejects.toMatchObject({ kind: 'outdated' })
    session.close()
  })

  it('NCALayer оборвал соединение посреди операции — failed, замок снят', async () => {
    const session = await connected()
    const signed = session.signAuth('bm9uY2U=', 'ru')
    current().onclose?.({})
    await expect(signed).rejects.toMatchObject({ kind: 'failed' })
    // Сессия закрыта сама — следующая операция начинается без «busy».
    const next = await connected()
    next.close()
  })

  it('второй запрос подписи на той же сессии, пока первый ждёт ответа, — busy', async () => {
    const session = await connected()
    const first = session.signAuth('bm9uY2U=', 'ru')
    await expect(session.signAuth('bm9uY2U=', 'ru')).rejects.toMatchObject({ kind: 'busy' })
    current().reply({ status: true, body: { result: ['MIIcms=='] } })
    await expect(first).resolves.toBe('MIIcms==')
    session.close()
  })
})

describe('signChallengeWithNcaLayer', () => {
  it('challenge — после приветствия; подписывает nonce и закрывает сокет', async () => {
    const order: string[] = []
    const requestChallenge = vi.fn(async () => {
      order.push('challenge')
      return { challengeId: 'c-1', nonce: 'bm9uY2U=' }
    })
    const onAwaitingKey = vi.fn(() => {
      order.push('awaiting')
      // Окно выбора ключа «открыто» — NCALayer отвечает подписью.
      queueMicrotask(() => current().reply({ status: true, body: { result: ['MIIcms=='] } }))
    })

    const pending = signChallengeWithNcaLayer(requestChallenge, {
      ...options(),
      locale: 'ru',
      onAwaitingKey,
    })
    await flush()
    expect(requestChallenge).not.toHaveBeenCalled()
    order.push('greet')
    current().greet()

    await expect(pending).resolves.toEqual({ challengeId: 'c-1', cms: 'MIIcms==' })
    expect(order).toEqual(['greet', 'challenge', 'awaiting'])
    expect(current().closed).toBe(true)
  })

  it('NCALayer не запущен — challenge у сервера не запрашивается', async () => {
    const requestChallenge = vi.fn(async () => ({ challengeId: 'c-1', nonce: 'bm9uY2U=' }))
    const pending = signChallengeWithNcaLayer(requestChallenge, { ...options(), locale: 'ru' })
    await flush()
    current().refuse()
    await expect(pending).rejects.toBeInstanceOf(NcaLayerError)
    expect(requestChallenge).not.toHaveBeenCalled()
  })

  it('ошибка сервера при выдаче challenge уходит как есть, сокет закрыт', async () => {
    const serverError = { code: 'FEATURE_DISABLED', message: 'off' }
    const pending = signChallengeWithNcaLayer(() => Promise.reject(serverError), {
      ...options(),
      locale: 'ru',
    })
    await flush()
    current().greet()
    await expect(pending).rejects.toBe(serverError)
    expect(current().closed).toBe(true)
  })
})

describe('ncaLayerLocale', () => {
  it('kz — платформенный kk, ru — как есть, английского окна у NCALayer нет — русский', () => {
    expect(ncaLayerLocale('kz')).toBe('kk')
    expect(ncaLayerLocale('ru')).toBe('ru')
    expect(ncaLayerLocale('en')).toBe('ru')
  })
})
