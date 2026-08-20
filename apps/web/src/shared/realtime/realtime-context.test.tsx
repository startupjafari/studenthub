import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock хойстится в начало файла — моки и общее состояние объявляем через vi.hoisted.
const { socketMock, ioMock, state, invalidateMock } = vi.hoisted(() => {
  const socketMock = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    // Обёртка вкладки-лидера ретранслирует все события сервера в шину между вкладками.
    onAny: vi.fn(),
    offAny: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    auth: {} as { token?: string },
  }
  return {
    socketMock,
    ioMock: vi.fn((..._args: unknown[]) => socketMock),
    state: { token: null as string | null },
    invalidateMock: vi.fn(),
  }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))
// Токен из Redux подменяем изменяемым state.token, чтобы гонять ротацию/логаут через rerender.
vi.mock('../store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { accessToken: state.token } }),
}))
// Провайдер использует useQueryClient (реконнект-ресинк) — стаб без реального QueryClientProvider.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}))

import { REALTIME_CHANNEL } from '@studenthub/shared-schemas'
// Импорт после vi.mock — провайдер увидит замоканные модули.
import { RealtimeProvider, useRealtimeEvent, useRealtimeEnvelope } from './realtime-context'

beforeEach(() => {
  socketMock.on.mockClear()
  socketMock.off.mockClear()
  socketMock.emit.mockClear()
  socketMock.onAny.mockClear()
  socketMock.offAny.mockClear()
  socketMock.disconnect.mockClear()
  socketMock.connected = false
  socketMock.auth = {}
  ioMock.mockClear()
  invalidateMock.mockClear()
  state.token = null
  // Здесь проверяется одиночная вкладка: без BroadcastChannel выборы мастера вырождаются и
  // вкладка становится лидером синхронно. Многовкладочный режим — realtime-multitab.test.tsx.
  vi.stubGlobal('BroadcastChannel', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealtimeProvider — жизненный цикл соединения', () => {
  it('без токена не подключается', () => {
    state.token = null
    render(<RealtimeProvider>x</RealtimeProvider>)
    expect(ioMock).not.toHaveBeenCalled()
  })

  it('подключается один раз при появлении токена', () => {
    state.token = 't1'
    render(<RealtimeProvider>x</RealtimeProvider>)
    expect(ioMock).toHaveBeenCalledTimes(1)
    const opts = ioMock.mock.calls[0]?.[1] as { auth?: { token?: string } } | undefined
    expect(opts?.auth).toEqual({ token: 't1' })
  })

  it('ротация токена НЕ пересоздаёт сокет — шлёт auth:refresh и обновляет auth', () => {
    state.token = 't1'
    const { rerender } = render(<RealtimeProvider>x</RealtimeProvider>)
    expect(ioMock).toHaveBeenCalledTimes(1)

    state.token = 't2'
    rerender(<RealtimeProvider>y</RealtimeProvider>)

    // Соединение не пересоздано.
    expect(ioMock).toHaveBeenCalledTimes(1)
    // Сессия обновлена без разрыва.
    expect(socketMock.emit).toHaveBeenCalledWith('auth:refresh', { token: 't2' })
    // Реконнект после ротации пойдёт уже со свежим токеном.
    expect(socketMock.auth).toEqual({ token: 't2' })
  })

  it('логаут (токен → null) рвёт соединение', () => {
    state.token = 't1'
    const { rerender } = render(<RealtimeProvider>x</RealtimeProvider>)
    state.token = null
    rerender(<RealtimeProvider>y</RealtimeProvider>)
    expect(socketMock.disconnect).toHaveBeenCalled()
  })

  // Регрессия реконнект-ресинка: первый connect кэш не трогает, повторный (реконнект после
  // обрыва) инвалидирует react-query, чтобы подтянуть пропущенные события.
  it('реконнект инвалидирует кэш, первый connect — нет', () => {
    state.token = 't1'
    render(<RealtimeProvider>x</RealtimeProvider>)
    const onConnect = socketMock.on.mock.calls.find((c) => c[0] === 'connect')?.[1] as
      (() => void) | undefined
    expect(onConnect).toBeTypeOf('function')
    onConnect?.() // первый connect — ресинк не нужен
    expect(invalidateMock).not.toHaveBeenCalled()
    onConnect?.() // реконнект — инвалидируем
    expect(invalidateMock).toHaveBeenCalledTimes(1)
  })
})

describe('useRealtimeEvent — подписка/отписка', () => {
  function Consumer(): null {
    useRealtimeEvent('message:new', () => {})
    return null
  }

  it('подписывается на событие и отписывается при размонтировании', () => {
    state.token = 't1'
    const { unmount } = render(
      <RealtimeProvider>
        <Consumer />
      </RealtimeProvider>,
    )
    expect(socketMock.on).toHaveBeenCalledWith('message:new', expect.any(Function))
    unmount()
    expect(socketMock.off).toHaveBeenCalledWith('message:new', expect.any(Function))
  })
})

describe('useRealtimeEnvelope — единый конверт event', () => {
  function EnvConsumer({ onEvent }: { onEvent: (e: unknown) => void }): null {
    useRealtimeEnvelope('application.status.changed', onEvent)
    return null
  }

  function envelope(type: string) {
    return { type, entityId: 'x1', version: 1, ts: '2026-01-01T00:00:00.000Z', data: {} }
  }

  it('слушает канал REALTIME_CHANNEL и фильтрует по type', () => {
    state.token = 't1'
    const handler = vi.fn()
    render(
      <RealtimeProvider>
        <EnvConsumer onEvent={handler} />
      </RealtimeProvider>,
    )

    // Подписка идёт на единый канал (не на именованное событие).
    const call = socketMock.on.mock.calls.find((c) => c[0] === REALTIME_CHANNEL)
    expect(call).toBeTruthy()
    const listener = call![1] as (e: unknown) => void

    // Нужный type — обработчик вызывается c конвертом.
    listener(envelope('application.status.changed'))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application.status.changed', entityId: 'x1' }),
    )

    // Чужой type — игнорируется.
    listener(envelope('grade.published'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('отписывается от канала при размонтировании', () => {
    state.token = 't1'
    const { unmount } = render(
      <RealtimeProvider>
        <EnvConsumer onEvent={vi.fn()} />
      </RealtimeProvider>,
    )
    unmount()
    expect(socketMock.off).toHaveBeenCalledWith(REALTIME_CHANNEL, expect.any(Function))
  })
})
