import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

import { toast } from 'sonner'
import { recoverFromChunkError, useAppUpdate, useChunkErrorRecovery } from './use-sw-update'

// Обновление установленного приложения: новый service worker → тост «Доступна новая версия»
// → SKIP_WAITING → controllerchange → перезагрузка. В jsdom service worker нет —
// подставляем регистрацию и контейнер, события шлём руками.

class FakeWorker extends EventTarget {
  state = 'installing'
  postMessage = vi.fn()

  install(): void {
    this.state = 'installed'
    this.dispatchEvent(new Event('statechange'))
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null
  installing: FakeWorker | null = null
  update = vi.fn(() => Promise.resolve())
}

function installContainer(options: {
  /** Что отдаёт getRegistration() — на первом заходе next-pwa ещё не успел зарегистрировать SW. */
  registration?: FakeRegistration
  /** Чем разрешится `ready`; без значения — не разрешится вовсе. */
  ready?: FakeRegistration
  /** Есть ли контроллер: без него это первая установка, а не обновление. */
  controlled?: boolean
}) {
  const container = Object.assign(new EventTarget(), {
    controller: options.controlled === false ? null : ({} as ServiceWorker),
    getRegistration: vi.fn(() => Promise.resolve(options.registration)),
    ready: options.ready ? Promise.resolve(options.ready) : new Promise<never>(() => undefined),
  })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  return container
}

/** Дать отработать промисам getRegistration/ready/update внутри эффекта. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  vi.mocked(toast).mockClear()
})

afterEach(() => {
  // Сначала размонтировать хук — его уборка снимает слушатели с контейнера SW.
  cleanup()
  vi.unstubAllGlobals()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('useAppUpdate — новый service worker', () => {
  it('обновление скачано, пока приложение было закрыто: сразу тост, «Обновить» шлёт SKIP_WAITING', async () => {
    const reg = new FakeRegistration()
    reg.waiting = new FakeWorker()
    installContainer({ registration: reg })

    const { result } = renderHook(() => useAppUpdate())
    await flush()

    expect(result.current.state).toBe('ready')
    expect(toast).toHaveBeenCalledWith(
      'updateAvailable',
      expect.objectContaining({ id: 'sw-update', duration: Infinity }),
    )
    // Тост не закрывается сам и не перезагружает страницу за спиной.
    expect(reload).not.toHaveBeenCalled()

    act(() => result.current.apply())
    expect(reg.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })

    const options = vi.mocked(toast).mock.calls[0]?.[1] as unknown as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    expect(reg.waiting.postMessage).toHaveBeenCalledTimes(2)
  })

  it('первый заход: регистрации ещё нет, хук подхватывает её из ready и проверяет обновление', async () => {
    const reg = new FakeRegistration()
    installContainer({ registration: undefined, ready: reg })

    const { result } = renderHook(() => useAppUpdate())
    await flush()

    expect(reg.update).toHaveBeenCalledTimes(1)

    // Обновление, найденное позже, всё равно доходит до тоста.
    const installing = new FakeWorker()
    reg.installing = installing
    act(() => {
      reg.dispatchEvent(new Event('updatefound'))
      reg.waiting = installing
      installing.install()
    })
    expect(result.current.state).toBe('ready')
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('регистрация из getRegistration и из ready — одна и та же: подписка не дублируется', async () => {
    const reg = new FakeRegistration()
    installContainer({ registration: reg, ready: reg })

    renderHook(() => useAppUpdate())
    await flush()

    expect(reg.update).toHaveBeenCalledTimes(1)
  })

  it('первая установка (контроллера нет) — не обновление, тоста нет', async () => {
    const reg = new FakeRegistration()
    installContainer({ registration: reg, controlled: false })

    const { result } = renderHook(() => useAppUpdate())
    await flush()

    const installing = new FakeWorker()
    reg.installing = installing
    act(() => {
      reg.dispatchEvent(new Event('updatefound'))
      installing.install()
    })
    expect(toast).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('новый SW взял управление — одна перезагрузка, даже если событие пришло дважды', async () => {
    const reg = new FakeRegistration()
    const container = installContainer({ registration: reg })

    renderHook(() => useAppUpdate())
    await flush()

    container.dispatchEvent(new Event('controllerchange'))
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('первый контроллер (его не было вовсе) перезагрузку не вызывает', async () => {
    const container = installContainer({ registration: new FakeRegistration(), controlled: false })

    renderHook(() => useAppUpdate())
    await flush()

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
  })

  it('возвращение к приложению проверяет обновление ещё раз', async () => {
    const reg = new FakeRegistration()
    installContainer({ registration: reg })

    renderHook(() => useAppUpdate())
    await flush()
    expect(reg.update).toHaveBeenCalledTimes(1)

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockRestore()

    expect(reg.update).toHaveBeenCalledTimes(2)
  })

  it('после размонтирования слушатели сняты', async () => {
    const reg = new FakeRegistration()
    const container = installContainer({ registration: reg })

    const { unmount } = renderHook(() => useAppUpdate())
    await flush()
    unmount()

    container.dispatchEvent(new Event('controllerchange'))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    visibility.mockRestore()
    expect(reload).not.toHaveBeenCalled()
    expect(reg.update).toHaveBeenCalledTimes(1)
  })
})

describe('useAppUpdate — кнопка «Проверить обновление»', () => {
  it('без service worker отвечает «последняя версия», а не молчит', () => {
    const { result } = renderHook(() => useAppUpdate())

    act(() => result.current.check())
    expect(result.current.state).toBe('current')
  })

  it('нашлось обновление — ready; не нашлось — current; сбой проверки — current', async () => {
    const reg = new FakeRegistration()
    installContainer({ registration: reg })
    const { result } = renderHook(() => useAppUpdate())
    await flush()

    reg.update.mockImplementationOnce(() => {
      reg.installing = new FakeWorker()
      return Promise.resolve()
    })
    act(() => result.current.check())
    expect(result.current.state).toBe('checking')
    await flush()
    expect(result.current.state).toBe('ready')

    reg.installing = null
    act(() => result.current.check())
    await flush()
    expect(result.current.state).toBe('current')

    reg.update.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    act(() => result.current.check())
    await flush()
    expect(result.current.state).toBe('current')
  })

  it('apply без ждущего SW просто перезагружает страницу', () => {
    const { result } = renderHook(() => useAppUpdate())
    act(() => result.current.apply())
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('recoverFromChunkError — не чаще раза в минуту', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('первая ошибка куска перезагружает, повтор в ту же минуту — нет, через минуту — снова да', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(recoverFromChunkError()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + 30_000)
    expect(recoverFromChunkError()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + 61_000)
    expect(recoverFromChunkError()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('недоступное хранилище (приватный режим) не мешает перезагрузке', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(recoverFromChunkError()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('useChunkErrorRecovery', () => {
  beforeEach(() => sessionStorage.clear())

  it('ошибка загрузки куска вне React — перезагрузка; обычная ошибка — нет', () => {
    const { unmount } = renderHook(() => useChunkErrorRecovery())

    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('Cannot read properties of undefined') }),
    )
    expect(reload).not.toHaveBeenCalled()

    const chunk = new Error('Loading chunk app/(student)/page failed.')
    chunk.name = 'ChunkLoadError'
    window.dispatchEvent(new ErrorEvent('error', { error: chunk }))
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    sessionStorage.clear()
    // Без поля error: иначе раннер сочтёт событие необработанной ошибкой теста.
    window.dispatchEvent(new ErrorEvent('error', { message: chunk.message }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
