import { EventsRealtime } from './events-realtime'
import type { RealtimeGateway } from '../../common/realtime'

// Адрес сигнала event.changed и склейка записей (§9.2d).
function setup() {
  const gateway = { emitEventToRoom: jest.fn(), emitEventToAll: jest.fn() }
  const live = new EventsRealtime(gateway as unknown as RealtimeGateway)
  return { live, gateway }
}

describe('EventsRealtime', () => {
  afterEach(() => jest.useRealTimers())

  it('событие вуза → комната вуза; событие платформы без вуза → всем', () => {
    const { live, gateway } = setup()
    live.changed({ id: 'e1', universityId: 'uni1' }, 'created')
    expect(gateway.emitEventToRoom).toHaveBeenCalledWith('university:uni1', 'event.changed', 'e1', {
      kind: 'created',
    })
    live.changed({ id: 'e2', universityId: null }, 'deleted')
    expect(gateway.emitEventToAll).toHaveBeenCalledWith('event.changed', 'e2', { kind: 'deleted' })
  })

  it('записи одного события за 2 с склеиваются в один сигнал', () => {
    jest.useFakeTimers()
    const { live, gateway } = setup()
    for (let i = 0; i < 5; i++) live.changed({ id: 'e1', universityId: 'uni1' }, 'registrations')
    live.changed({ id: 'e2', universityId: 'uni1' }, 'registrations')
    expect(gateway.emitEventToRoom).not.toHaveBeenCalled()
    jest.advanceTimersByTime(2000)
    expect(gateway.emitEventToRoom).toHaveBeenCalledTimes(2)
    live.onModuleDestroy()
  })

  it('сбой рассылки не бросает наружу', () => {
    const { live, gateway } = setup()
    gateway.emitEventToRoom.mockImplementation(() => {
      throw new Error('нет сервера')
    })
    expect(() => live.changed({ id: 'e1', universityId: 'uni1' }, 'updated')).not.toThrow()
  })
})
