import { meetingProviderOf } from '@studenthub/shared-schemas'

// Провайдер встречи ставит сервер по хосту ссылки, и подпись «Zoom/Teams» в карточке —
// обещание, что ссылка ведёт к этому сервису. Сравнение — только по границе домена.

describe('meetingProviderOf — провайдер по хосту ссылки', () => {
  it.each([
    ['https://teams.microsoft.com/l/meetup-join/abc', 'TEAMS'],
    ['https://eu.teams.microsoft.com/l/meetup-join/abc', 'TEAMS'],
    ['https://teams.live.com/meet/123', 'TEAMS'],
    ['https://us02web.zoom.us/j/123', 'ZOOM'],
    ['https://zoom.us:443/j/123', 'ZOOM'],
    ['https://meet.google.com/abc-defg-hij', 'GOOGLE_MEET'],
  ])('%s → %s', (url, provider) => {
    expect(meetingProviderOf(url)).toBe(provider)
  })

  it.each([
    'https://xteams.microsoft.com/l/meetup-join/abc',
    'https://fakteams.live.com/meet/123',
    'https://teams.microsoft.com.evil.example/join',
    'https://notzoom.us/j/123',
    'https://jitsi.example.kz/room',
  ])('%s → OTHER', (url) => {
    expect(meetingProviderOf(url)).toBe('OTHER')
  })
})
