import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Код service worker (apps/web/worker/index.ts): показ Web Push, переход по клику и команда
// SKIP_WAITING от тоста обновления. Тест живёт здесь, а не рядом с воркером: vitest
// собирает тесты только из src, а tsconfig приложения намеренно не включает worker — у него
// своя библиотека типов (webworker), несовместимая с dom. Поэтому модуль подгружается по
// пути из переменной: так его не тянет проверка типов приложения, а vitest исполняет как есть.
const WORKER_MODULE = '../../../worker/index'

type Listener = (event: unknown) => void

const listeners = new Map<string, Listener>()
const fakeSelf = {
  addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  skipWaiting: vi.fn(() => Promise.resolve()),
  registration: { showNotification: vi.fn(() => Promise.resolve()) },
  clients: {
    matchAll: vi.fn(() => Promise.resolve([] as unknown[])),
    openWindow: vi.fn(() => Promise.resolve(null)),
  },
}

function dispatch(type: string, event: unknown): void {
  const listener = listeners.get(type)
  if (!listener) throw new Error(`service worker не подписан на «${type}»`)
  listener(event)
}

function pushEvent(data: { json: () => unknown; text: () => string } | null) {
  return { data, waitUntil: vi.fn() }
}

function jsonData(payload: unknown) {
  return { json: () => payload, text: () => JSON.stringify(payload) }
}

beforeAll(async () => {
  vi.stubGlobal('self', fakeSelf)
  await import(/* @vite-ignore */ WORKER_MODULE)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  fakeSelf.skipWaiting.mockClear()
  fakeSelf.registration.showNotification.mockClear()
  fakeSelf.clients.matchAll.mockReset().mockResolvedValue([])
  fakeSelf.clients.openWindow.mockClear()
})

describe('service worker — push', () => {
  it('показывает уведомление из пуша: заголовок, текст, ссылка перехода', () => {
    const event = pushEvent(
      jsonData({ title: 'Новое сообщение', body: 'Привет', url: '/chats/c1' }),
    )

    dispatch('push', event)

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith('Новое сообщение', {
      body: 'Привет',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/chats/c1' },
    })
    // Без waitUntil браузер может усыпить воркер раньше, чем плашка появится.
    expect(event.waitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('ключ группы заменяет прежнюю плашку и всё же звучит (renotify)', () => {
    dispatch('push', pushEvent(jsonData({ title: 'Чат', body: '2', tag: 'new-message:chat:c1' })))

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      'Чат',
      expect.objectContaining({ tag: 'new-message:chat:c1', renotify: true }),
    )
  })

  it('без ключа группы tag и renotify не ставятся — плашки не схлопываются', () => {
    dispatch('push', pushEvent(jsonData({ title: 'Оценка', body: '5' })))

    const [, options] = fakeSelf.registration.showNotification.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ]
    expect(options).not.toHaveProperty('tag')
    expect(options).not.toHaveProperty('renotify')
  })

  it('тело не JSON — показывается как текст под заголовком приложения', () => {
    const data = {
      json: () => {
        throw new SyntaxError('Unexpected token')
      },
      text: () => 'просто текст',
    }

    dispatch('push', pushEvent(data))

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      'StudentHub',
      expect.objectContaining({ body: 'просто текст', data: { url: '/' } }),
    )
  })

  it('пуш без данных — заголовок приложения, пустой текст и переход на главную', () => {
    dispatch('push', pushEvent(null))

    expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
      'StudentHub',
      expect.objectContaining({ body: '', data: { url: '/' } }),
    )
  })
})

describe('service worker — команда обновления', () => {
  it('SKIP_WAITING от страницы активирует новый воркер', () => {
    dispatch('message', { data: { type: 'SKIP_WAITING' } })
    expect(fakeSelf.skipWaiting).toHaveBeenCalledTimes(1)
  })

  it('прочие сообщения и пустые данные воркер не активируют', () => {
    dispatch('message', { data: { type: 'PING' } })
    dispatch('message', { data: undefined })
    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('service worker — клик по уведомлению', () => {
  function clickEvent(data: unknown) {
    return { notification: { data, close: vi.fn() }, waitUntil: vi.fn() }
  }

  async function settle(event: { waitUntil: ReturnType<typeof vi.fn> }): Promise<void> {
    await (event.waitUntil.mock.calls[0]?.[0] as Promise<unknown>)
  }

  it('открытая вкладка приложения ведётся по ссылке и получает фокус', async () => {
    const client = { navigate: vi.fn(() => Promise.resolve(null)), focus: vi.fn() }
    fakeSelf.clients.matchAll.mockResolvedValue([client])
    const event = clickEvent({ url: '/applications/a1' })

    dispatch('notificationclick', event)
    await settle(event)

    expect(event.notification.close).toHaveBeenCalled()
    expect(fakeSelf.clients.matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: true,
    })
    expect(client.navigate).toHaveBeenCalledWith('/applications/a1')
    expect(client.focus).toHaveBeenCalled()
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled()
  })

  it('вкладки нет — открывается новое окно по ссылке', async () => {
    const event = clickEvent({ url: '/schedule' })

    dispatch('notificationclick', event)
    await settle(event)

    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith('/schedule')
  })

  it('без ссылки в уведомлении — на главную', async () => {
    const event = clickEvent(undefined)

    dispatch('notificationclick', event)
    await settle(event)

    expect(fakeSelf.clients.openWindow).toHaveBeenCalledWith('/')
  })

  it('отказ перехода во вкладке не мешает её сфокусировать', async () => {
    const client = {
      navigate: vi.fn(() => Promise.reject(new TypeError('not controlled'))),
      focus: vi.fn(),
    }
    fakeSelf.clients.matchAll.mockResolvedValue([client])
    const event = clickEvent({ url: '/chats' })

    dispatch('notificationclick', event)
    await settle(event)

    expect(client.focus).toHaveBeenCalled()
    expect(fakeSelf.clients.openWindow).not.toHaveBeenCalled()
  })
})
