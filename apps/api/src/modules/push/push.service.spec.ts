import { PushService } from './push.service'

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
