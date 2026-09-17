import type { ThrottlerStorage } from '@nestjs/throttler'
import { ResilientThrottlerStorage } from './resilient-throttler.storage'

// Счётчики rate limit живут в Redis, а Redis настроен падать быстро. Проверяем главное:
// сбой кэша не должен выходить из ThrottlerGuard наружу и выключать приём запросов.
describe('ResilientThrottlerStorage', () => {
  const record = { totalHits: 3, timeToExpire: 42, isBlocked: false, timeToBlockExpire: 0 }

  it('в норме отдаёт ответ хранилища как есть', async () => {
    const inner = { increment: jest.fn().mockResolvedValue(record) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    await expect(storage.increment('k', 60, 100, 0, 'default')).resolves.toEqual(record)
    expect(inner.increment).toHaveBeenCalledWith('k', 60, 100, 0, 'default')
  })

  it('передаёт блокировку, а не сглаживает её', async () => {
    const blocked = { totalHits: 101, timeToExpire: 10, isBlocked: true, timeToBlockExpire: 30 }
    const inner = { increment: jest.fn().mockResolvedValue(blocked) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    await expect(storage.increment('k', 60, 100, 0, 'default')).resolves.toEqual(blocked)
  })

  it('при недоступном Redis пропускает запрос, а не роняет его', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    const result = await storage.increment('k', 60, 100, 0, 'default')

    expect(result).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    })
  })

  it('не заливает лог: предупреждение не чаще раза в минуту', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('down')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)
    const warn = jest
      .spyOn((storage as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
      .mockImplementation(() => undefined)

    for (let i = 0; i < 20; i++) {
      await storage.increment('k', 60, 100, 0, 'default')
    }

    expect(warn).toHaveBeenCalledTimes(1)
  })
})
