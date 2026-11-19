import { REALTIME_EVENTS } from '@studenthub/shared-schemas'
import type { RealtimeGateway } from '../../common/realtime'
import { StoryLiveEvents } from './story-live-events'

describe('StoryLiveEvents', () => {
  function setup() {
    const realtime = { emitEventToRooms: jest.fn() }
    return { live: new StoryLiveEvents(realtime as unknown as RealtimeGateway), realtime }
  }

  it('вуз автора и его личная комната; в данных — только id автора', () => {
    const { live, realtime } = setup()
    live.changed({ id: 'a1', universityId: 'uni-1' })
    expect(realtime.emitEventToRooms).toHaveBeenCalledWith(
      ['university:uni-1', 'user:a1'],
      REALTIME_EVENTS.storiesChanged,
      'a1',
      { authorId: 'a1' },
    )
  })

  it('автор без вуза — только своя комната', () => {
    const { live, realtime } = setup()
    live.changed({ id: 'a1', universityId: null })
    expect(realtime.emitEventToRooms.mock.calls[0][0]).toEqual(['user:a1'])
  })

  it('сбой рассылки не пробрасывается', () => {
    const { live, realtime } = setup()
    realtime.emitEventToRooms.mockImplementation(() => {
      throw new Error('socket down')
    })
    expect(() => live.changed({ id: 'a1', universityId: 'uni-1' })).not.toThrow()
  })
})
