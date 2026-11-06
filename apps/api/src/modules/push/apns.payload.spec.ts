import { apnsOutcome, buildApnsPayload } from './apns.payload'

describe('buildApnsPayload', () => {
  it('обычный пуш несёт заголовок, текст и звук', () => {
    const payload = JSON.parse(
      buildApnsPayload({ title: 'Новое сообщение', body: 'Привет', badge: 3 }),
    )

    expect(payload.aps.alert).toEqual({ title: 'Новое сообщение', body: 'Привет' })
    expect(payload.aps.sound).toBe('default')
    expect(payload.aps.badge).toBe(3)
  })

  // Алерт с пустым текстом показал бы человеку пустую плашку.
  it('тихий пуш уходит без алерта', () => {
    const payload = JSON.parse(buildApnsPayload({ silent: true }))

    expect(payload.aps['content-available']).toBe(1)
    expect(payload.aps.alert).toBeUndefined()
    expect(payload.aps.sound).toBeUndefined()
  })

  // Ноль гасит бейдж осознанно, а отсутствие поля не трогает его вовсе.
  it('различает ноль и отсутствие бейджа', () => {
    expect(JSON.parse(buildApnsPayload({ badge: 0 })).aps.badge).toBe(0)
    expect(JSON.parse(buildApnsPayload({})).aps.badge).toBeUndefined()
  })

  // Сообщения одного чата складываются в одну стопку уведомлений.
  it('ключ группы уходит в thread-id, у тихого — нет', () => {
    expect(JSON.parse(buildApnsPayload({ title: 'т', tag: 'chat:1' })).aps['thread-id']).toBe(
      'chat:1',
    )
    expect(
      JSON.parse(buildApnsPayload({ silent: true, tag: 'chat:1' })).aps['thread-id'],
    ).toBeUndefined()
    expect(JSON.parse(buildApnsPayload({ title: 'т' })).aps['thread-id']).toBeUndefined()
  })

  it('ссылку перехода кладёт рядом с aps', () => {
    const payload = JSON.parse(buildApnsPayload({ title: 'т', url: '/chats?c=1' }))

    expect(payload.url).toBe('/chats?c=1')
  })
})

describe('apnsOutcome', () => {
  it('2xx — доставлено', () => {
    expect(apnsOutcome(200, '')).toBe('delivered')
  })

  // Приложение удалили или переустановили: адреса больше нет, строку чистим.
  it('410 и BadDeviceToken означают, что устройства больше нет', () => {
    expect(apnsOutcome(410, '')).toBe('gone')
    expect(apnsOutcome(400, JSON.stringify({ reason: 'BadDeviceToken' }))).toBe('gone')
    expect(apnsOutcome(410, JSON.stringify({ reason: 'Unregistered' }))).toBe('gone')
  })

  // Перегрузка и сбой шлюза — повод попробовать позже, а не выбрасывать устройство.
  it('прочие отказы оставляют устройство на месте', () => {
    expect(apnsOutcome(429, JSON.stringify({ reason: 'TooManyRequests' }))).toBe('retry')
    expect(apnsOutcome(503, 'не JSON вовсе')).toBe('retry')
  })
})
