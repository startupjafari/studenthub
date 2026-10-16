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
