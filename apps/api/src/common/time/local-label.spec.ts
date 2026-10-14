import { localDateTimeLabel } from './local-label'

describe('localDateTimeLabel', () => {
  const at = new Date('2026-10-02T04:00:00.000Z')

  it('время в поясе вуза, а не UTC', () => {
    expect(localDateTimeLabel(at, 'Asia/Almaty')).toBe('2026-10-02 09:00')
  })

  it('без пояса и с битым поясом — UTC', () => {
    expect(localDateTimeLabel(at, null)).toBe('2026-10-02 04:00')
    expect(localDateTimeLabel(at, 'Mars/Olympus')).toBe('2026-10-02 04:00')
  })
})
