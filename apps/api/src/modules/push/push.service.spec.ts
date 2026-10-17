import { Logger } from '@nestjs/common'
import webpush from 'web-push'
import { PushService } from './push.service'

// Настоящий web-push ходит в сеть к push-сервису браузера — в юнитах подменяем.
jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}))

type Mock = jest.Mock

function makeService() {
  const tx = {
    deviceToken: { findUnique: jest.fn() as Mock, upsert: jest.fn() as Mock },
    notificationSettings: { upsert: jest.fn() as Mock },
  }
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  const service = new PushService(
    prisma as never,
    { get: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { service, tx }
}

const input = { token: 'a'.repeat(64), platform: 'IOS' as const, appVersion: '1.0.0' }

describe('PushService.registerDevice', () => {
  // Пуши по умолчанию выключены — без этого телефон после установки молчал бы.
  it('новое устройство включает пуши', async () => {
    const { service, tx } = makeService()
    tx.deviceToken.findUnique.mockResolvedValue(null)

    await service.registerDevice('u1', input)

    expect(tx.deviceToken.upsert).toHaveBeenCalled()
    expect(tx.notificationSettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { pushEnabled: true },
      create: { userId: 'u1', pushEnabled: true },
    })
  })

  it('устройство, перешедшее от другого аккаунта, включает пуши новому владельцу', async () => {
    const { service, tx } = makeService()
    tx.deviceToken.findUnique.mockResolvedValue({ userId: 'u2' })

    await service.registerDevice('u1', input)

    expect(tx.notificationSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  // Приложение подтверждает токен на каждом запуске: выключенные пуши должны остаться выключенными.
  it('повторная регистрация того же устройства настройки не трогает', async () => {
    const { service, tx } = makeService()
    tx.deviceToken.findUnique.mockResolvedValue({ userId: 'u1' })

    await service.registerDevice('u1', input)

    expect(tx.deviceToken.upsert).toHaveBeenCalled()
    expect(tx.notificationSettings.upsert).not.toHaveBeenCalled()
  })
})

// F-F25: адресату с открытой вкладкой браузерный push не нужен, телефону — нужен.
describe('PushService.sendToUser — каналы', () => {
  function withDevices() {
    const prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([{ endpoint: 'e', p256dh: 'p', auth: 'a' }]),
      },
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([{ token: 't1', platform: 'IOS' }]),
        deleteMany: jest.fn(),
      },
      notification: { count: jest.fn().mockResolvedValue(2) },
    }
    const apns = {
      isEnabled: jest.fn(() => true),
      send: jest.fn().mockResolvedValue('delivered'),
    }
    const fcm = { isEnabled: jest.fn(() => false), send: jest.fn() }
    const service = new PushService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      apns as never,
      fcm as never,
    )
    return { service, prisma, apns }
  }

  it('только телефоны: подписки браузеров не читаются, телефон получает ключ группы', async () => {
    const { service, prisma, apns } = withDevices()

    await service.sendToUser(
      'u1',
      { title: 'T', body: 'B', tag: 'new-message:chat:c1' },
      { web: false, devices: true },
    )

    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
    expect(apns.send).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ tag: 'new-message:chat:c1', badge: 2 }),
    )
  })

  it('без каналов по умолчанию — и браузеры, и телефоны', async () => {
    const { service, prisma, apns } = withDevices()

    await service.sendToUser('u1', { title: 'T', body: 'B' })

    // Web Push выключен (VAPID не задан) — до подписок дело не доходит, но телефон получает.
    expect(apns.send).toHaveBeenCalledTimes(1)
    expect(prisma.deviceToken.findMany).toHaveBeenCalled()
  })
})

// Отказ транспорта: «устройства больше нет» чистит строку, временный сбой — оставляет.
describe('PushService.sendToUser — телефоны', () => {
  function withPhones(devices: { token: string; platform: string }[]) {
    const prisma = {
      deviceToken: {
        findMany: jest.fn().mockResolvedValue(devices),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notification: { count: jest.fn().mockResolvedValue(5) },
    }
    const apns = { isEnabled: jest.fn(() => true), send: jest.fn().mockResolvedValue('delivered') }
    const fcm = { isEnabled: jest.fn(() => true), send: jest.fn().mockResolvedValue('delivered') }
    const service = new PushService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      apns as never,
      fcm as never,
    )
    return { service, prisma, apns, fcm }
  }
  const phonesOnly = { web: false, devices: true }

  it('транспорт выбирается по платформе записи: Android — FCM, iOS — APNs', async () => {
    const { service, apns, fcm } = withPhones([
      { token: 'ios-1', platform: 'IOS' },
      { token: 'and-1', platform: 'ANDROID' },
    ])

    await service.sendToUser('u1', { title: 'T', body: 'B', url: '/chats' }, phonesOnly)

    expect(apns.send).toHaveBeenCalledTimes(1)
    expect(apns.send).toHaveBeenCalledWith('ios-1', expect.objectContaining({ badge: 5 }))
    expect(fcm.send).toHaveBeenCalledTimes(1)
    expect(fcm.send).toHaveBeenCalledWith(
      'and-1',
      expect.objectContaining({ title: 'T', body: 'B', url: '/chats', badge: 5 }),
    )
  })

  it('«устройства больше нет» (gone) — токен удаляется', async () => {
    const { service, prisma, apns } = withPhones([{ token: 'ios-1', platform: 'IOS' }])
    apns.send.mockResolvedValue('gone')

    await service.sendToUser('u1', { title: 'T', body: 'B' }, phonesOnly)

    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'ios-1' } })
  })

  it('временный сбой или таймаут (retry) устройство не выбрасывает', async () => {
    const { service, prisma, fcm } = withPhones([{ token: 'and-1', platform: 'ANDROID' }])
    fcm.send.mockResolvedValue('retry')

    await service.sendToUser('u1', { title: 'T', body: 'B' }, phonesOnly)

    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled()
  })

  it('отказ одного устройства не отменяет доставку на другое', async () => {
    const { service, prisma, apns, fcm } = withPhones([
      { token: 'ios-1', platform: 'IOS' },
      { token: 'and-1', platform: 'ANDROID' },
    ])
    apns.send.mockResolvedValue('gone')

    await service.sendToUser('u1', { title: 'T', body: 'B' }, phonesOnly)

    expect(fcm.send).toHaveBeenCalledWith('and-1', expect.anything())
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { token: 'ios-1' } })
  })

  it('оба транспорта без ключей — в базу за устройствами и бейджем не ходим', async () => {
    const { service, prisma, apns, fcm } = withPhones([{ token: 'ios-1', platform: 'IOS' }])
    apns.isEnabled.mockReturnValue(false)
    fcm.isEnabled.mockReturnValue(false)

    await service.sendToUser('u1', { title: 'T', body: 'B' }, phonesOnly)

    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled()
    expect(prisma.notification.count).not.toHaveBeenCalled()
  })

  it('без устройств бейдж не считается', async () => {
    const { service, prisma } = withPhones([])

    await service.sendToUser('u1', { title: 'T', body: 'B' }, phonesOnly)

    expect(prisma.notification.count).not.toHaveBeenCalled()
  })
})

describe('PushService.sendToUser — браузеры (Web Push)', () => {
  const send = webpush.sendNotification as jest.Mock
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  function withBrowsers(vapid = true) {
    const prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([
          { endpoint: 'https://push.example/a', p256dh: 'p-a', auth: 'a-a' },
          { endpoint: 'https://push.example/b', p256dh: 'p-b', auth: 'a-b' },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const env: Record<string, string | undefined> = vapid
      ? { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:x@y.kz' }
      : {}
    const service = new PushService(
      prisma as never,
      { get: (key: string) => env[key] } as never,
      {} as never,
      { isEnabled: () => false } as never,
      { isEnabled: () => false } as never,
    )
    service.onModuleInit()
    return { service, prisma }
  }
  const browsersOnly = { web: true, devices: false }

  it('с VAPID шлёт каждой подписке тело JSON и с таймаутом сокета', async () => {
    send.mockResolvedValue({ statusCode: 201 })
    const { service } = withBrowsers()
    const payload = { title: 'T', body: 'B', url: '/x', tag: 'chat:c1' }

    await service.sendToUser('u1', payload, browsersOnly)

    expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:x@y.kz', 'pub', 'priv')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/a', keys: { p256dh: 'p-a', auth: 'a-a' } },
      JSON.stringify(payload),
      { timeout: expect.any(Number) },
    )
  })

  it.each([404, 410])('подписка мертва (%i) — удаляется по endpoint', async (statusCode) => {
    send.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode }))
    send.mockResolvedValueOnce({ statusCode: 201 })
    const { service, prisma } = withBrowsers()

    await service.sendToUser('u1', { title: 'T', body: 'B' }, browsersOnly)

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/a' },
    })
  })

  it('временный сбой push-сервиса (500, таймаут) подписку не трогает и отправку не роняет', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('boom'), { statusCode: 500 }))
    send.mockRejectedValueOnce(new Error('socket timeout'))
    const { service, prisma } = withBrowsers()

    await expect(
      service.sendToUser('u1', { title: 'T', body: 'B' }, browsersOnly),
    ).resolves.toBeUndefined()

    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('(500)'))
  })

  it('без VAPID-ключей Web Push молчит: ни подписок, ни отправки', async () => {
    const { service, prisma } = withBrowsers(false)

    await service.sendToUser('u1', { title: 'T', body: 'B' }, browsersOnly)

    expect(service.publicKey).toBeNull()
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
