import { buildFcmMessage, fcmOutcome } from './fcm.payload'

const unregistered = JSON.stringify({
  error: {
    code: 404,
    status: 'NOT_FOUND',
    message: 'Requested entity was not found.',
    details: [
      { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
    ],
  },
})

describe('buildFcmMessage', () => {
  // Блок notification отдал бы плашку системе — без нашего канала и перехода.
  it('обычный пуш уходит data-сообщением с высоким приоритетом', () => {
    const { message } = JSON.parse(
      buildFcmMessage('token-1', { title: 'Новое сообщение', body: 'Привет', badge: 3 }),
    )

    expect(message.token).toBe('token-1')
    expect(message.notification).toBeUndefined()
    expect(message.data).toEqual({ title: 'Новое сообщение', body: 'Привет', badge: '3' })
    expect(message.android.priority).toBe('high')
  })

  // FCM принимает в data только строки и отвергает сообщение с числом целиком.
  it('все значения data — строки', () => {
    const { message } = JSON.parse(
      buildFcmMessage('t', { title: 'т', badge: 0, url: '/chats?c=1' }),
    )

    for (const value of Object.values(message.data)) {
      expect(typeof value).toBe('string')
    }
    expect(message.data.badge).toBe('0')
    expect(message.data.url).toBe('/chats?c=1')
  })

  it('ключ группы приложению — строкой в data', () => {
    const { message } = JSON.parse(buildFcmMessage('t', { title: 'т', tag: 'chat:1' }))

    expect(message.data.tag).toBe('chat:1')
  })

  it('тихий пуш — без текста и без высокого приоритета', () => {
    const { message } = JSON.parse(buildFcmMessage('t', { silent: true }))

    expect(message.data).toEqual({ silent: '1' })
    expect(message.android.priority).toBe('normal')
  })
})

describe('fcmOutcome', () => {
  it('2xx — доставлено', () => {
    expect(fcmOutcome(200, '{"name":"projects/p/messages/1"}')).toBe('delivered')
  })

  // Приложение удалили или токен сменился: строку чистим.
  it('UNREGISTERED означает, что устройства больше нет', () => {
    expect(fcmOutcome(404, unregistered)).toBe('gone')
  })

  it('токен не FCM вовсе — тоже вычищаем', () => {
    const body = JSON.stringify({
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'The registration token is not a valid FCM registration token',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'INVALID_ARGUMENT',
          },
        ],
      },
    })
    expect(fcmOutcome(400, body)).toBe('gone')
  })

  // Ошибка в самом сообщении — не повод выбрасывать устройство.
  it('прочие INVALID_ARGUMENT оставляют устройство на месте', () => {
    const body = JSON.stringify({
      error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' },
    })
    expect(fcmOutcome(400, body)).toBe('retry')
  })

  it('квота и сбой шлюза — повод попробовать позже', () => {
    expect(fcmOutcome(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }))).toBe(
      'retry',
    )
    expect(fcmOutcome(503, 'не JSON вовсе')).toBe('retry')
  })
})
