import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Многовкладочный режим провайдера: соединение поднимает только вкладка-лидер.
// Одиночная вкладка (без BroadcastChannel) проверяется в realtime-context.test.tsx.
const { socketMock, ioMock, state, invalidateMock } = vi.hoisted(() => {
  const socketMock = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    onAny: vi.fn(),
    offAny: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
    auth: {} as { token?: string },
  }
  return {
    socketMock,
    ioMock: vi.fn((..._args: unknown[]) => socketMock),
    state: { token: null as string | null, userId: undefined as string | undefined },
    invalidateMock: vi.fn(),
  }
})
vi.mock('socket.io-client', () => ({ io: ioMock }))
vi.mock('../store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      auth: { accessToken: state.token, user: state.userId ? { id: state.userId } : undefined },
    }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}))

import { FakeBroadcastChannel } from './broadcast-channel.fake'
import { RealtimeProvider } from './realtime-context'

// С запасом перекрывает окно выборов (150 мс).
const ELECTION_WINDOW_MS = 300

function settle(): void {
  act(() => {
    vi.advanceTimersByTime(ELECTION_WINDOW_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeBroadcastChannel.reset()
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  ioMock.mockClear()
  socketMock.on.mockClear()
  socketMock.disconnect.mockClear()
  state.token = 'token-1'
  state.userId = 'user-1'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('RealtimeProvider — мастер-вкладка', () => {
  it('первая вкладка становится лидером и поднимает единственное соединение', () => {
    render(<RealtimeProvider>a</RealtimeProvider>)
    // До окончания выборов соединения нет — вдруг лидер уже есть в другой вкладке.
    expect(ioMock).not.toHaveBeenCalled()

    settle()
    expect(ioMock).toHaveBeenCalledTimes(1)
  })

  it('вторая вкладка того же аккаунта соединение НЕ поднимает', () => {
    render(<RealtimeProvider>a</RealtimeProvider>)
    settle()
    expect(ioMock).toHaveBeenCalledTimes(1)

    render(<RealtimeProvider>b</RealtimeProvider>)
    settle()

    // Ключевое свойство фичи: сокет по-прежнему один на обе вкладки.
    expect(ioMock).toHaveBeenCalledTimes(1)
  })

  it('вкладки разных аккаунтов делят соединение только внутри аккаунта', () => {
    render(<RealtimeProvider>a</RealtimeProvider>)
    settle()

    state.userId = 'user-2'
    render(<RealtimeProvider>b</RealtimeProvider>)
    settle()

    expect(ioMock).toHaveBeenCalledTimes(2)
  })

  it('уход лидера передаёт соединение оставшейся вкладке', () => {
    const first = render(<RealtimeProvider>a</RealtimeProvider>)
    settle()
    render(<RealtimeProvider>b</RealtimeProvider>)
    settle()
    expect(ioMock).toHaveBeenCalledTimes(1)

    // Вкладка-лидер закрылась: размонтирование шлёт resign.
    act(() => first.unmount())
    settle()

    // Вторая вкладка перехватила лидерство и подняла своё соединение.
    expect(ioMock).toHaveBeenCalledTimes(2)
    expect(socketMock.disconnect).toHaveBeenCalledTimes(1)
  })
})
