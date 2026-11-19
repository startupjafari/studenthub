import { ExamEvents } from './exam-events'
import type { RealtimeGateway } from '../../common/realtime'

// Адреса сигнала exam.changed (§9.2d).
function setup() {
  const gateway = { emitEventToRooms: jest.fn(), emitEventToUsers: jest.fn() }
  const live = new ExamEvents(gateway as unknown as RealtimeGateway)
  return { live, gateway }
}

describe('ExamEvents', () => {
  it('назначение → комната группы и личные комнаты преподавателей, без дублей и пустых', () => {
    const { live, gateway } = setup()
    live.changed({ id: 'ex-1', groupId: 'grp-1' }, 'scheduled', ['t-1', null, 't-1', 'e-1'])
    expect(gateway.emitEventToRooms).toHaveBeenCalledWith(
      ['group:grp-1', 'user:t-1', 'user:e-1'],
      'exam.changed',
      'ex-1',
      { kind: 'scheduled' },
    )
  })

  it('результаты → только студентам изменённых строк; пустой список — без отправки', () => {
    const { live, gateway } = setup()
    live.results('ex-1', [])
    expect(gateway.emitEventToUsers).not.toHaveBeenCalled()
    live.results('ex-1', ['st-1', 'st-2', 'st-1'])
    expect(gateway.emitEventToUsers).toHaveBeenCalledWith(
      ['st-1', 'st-2'],
      'exam.changed',
      'ex-1',
      {
        kind: 'results',
      },
    )
  })

  it('сбой рассылки не бросает наружу', () => {
    const { live, gateway } = setup()
    gateway.emitEventToRooms.mockImplementation(() => {
      throw new Error('нет сервера')
    })
    expect(() => live.changed({ id: 'ex-1', groupId: 'grp-1' }, 'cancelled', [])).not.toThrow()
  })
})
