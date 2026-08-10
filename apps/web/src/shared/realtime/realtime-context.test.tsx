import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock хойстится в начало файла — моки и общее состояние объявляем через vi.hoisted.
const { socketMock, ioMock, state } = vi.hoisted(() => {
  const socketMock = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    auth: {} as { token?: string },
  }
  return {
    socketMock,
    ioMock: vi.fn((..._args: unknown[]) => socketMock),
    state: { token: null as string | null },
  }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))
// Токен из Redux подменяем изменяемым state.token, чтобы гонять ротацию/логаут через rerender.
vi.mock('../store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { accessToken: state.token } }),
}))

// Импорт после vi.mock — провайдер увидит замоканные модули.
import { RealtimeProvider, useRealtimeEvent } from './realtime-context'

beforeEach(() => {
  socketMock.on.mockClear()
  socketMock.off.mockClear()
  socketMock.emit.mockClear()
  socketMock.disconnect.mockClear()
  socketMock.auth = {}
  ioMock.mockClear()
  state.token = null
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
