import { isPushServiceUrl } from './push-subscribe.dto'

describe('isPushServiceUrl', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
  ])('push-сервис браузера: %s', (url) => {
    expect(isPushServiceUrl(url)).toBe(true)
  })

  it.each([
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://10.0.0.5/push',
    'не адрес',
  ])('прочее отклоняется: %s', (url) => {
    expect(isPushServiceUrl(url)).toBe(false)
  })
})
