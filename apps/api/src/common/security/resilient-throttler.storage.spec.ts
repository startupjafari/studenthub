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

  it('при недоступном Redis не роняет запрос', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    const result = await storage.increment('k', 60_000, 100, 0, 'default')

    expect(result.isBlocked).toBe(false)
    expect(result.totalHits).toBe(1)
  })

  // Главное свойство фолбэка: сбой Redis не должен превращаться в отключение лимитов.
  // Иначе достаточно дождаться (или устроить) сбой кэша, чтобы перебирать пароль без счёта.
  it('при недоступном Redis продолжает считать попытки и блокирует по лимиту', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    const hits: number[] = []
    let blocked = false
    for (let i = 0; i < 6; i++) {
      const r = await storage.increment('login-key', 900_000, 5, 900_000, 'default')
      hits.push(r.totalHits)
      blocked ||= r.isBlocked
    }

    expect(hits.slice(0, 5)).toEqual([1, 2, 3, 4, 5])
    expect(blocked).toBe(true)
  })

  it('разные ключи считаются раздельно и в фолбэке', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('down')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    await storage.increment('a', 60_000, 100, 0, 'default')
    await storage.increment('a', 60_000, 100, 0, 'default')
    const other = await storage.increment('b', 60_000, 100, 0, 'default')

    expect(other.totalHits).toBe(1)
  })

  it('фолбэк отпускает ключ, когда окно истекло', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('down')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)

    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      for (let i = 0; i < 6; i++) await storage.increment('k', 60_000, 5, 60_000, 'default')
      expect((await storage.increment('k', 60_000, 5, 60_000, 'default')).isBlocked).toBe(true)

      jest.setSystemTime(new Date('2026-01-01T00:02:00Z'))
      const afterWindow = await storage.increment('k', 60_000, 5, 60_000, 'default')

      expect(afterWindow.isBlocked).toBe(false)
      expect(afterWindow.totalHits).toBe(1)
    } finally {
      jest.useRealTimers()
    }
  })

  // Фолбэк не должен оставлять после себя таймеры: иначе процесс на выходе ждёт их,
  // и деплой после сбоя Redis висит до конца окна (до 15 минут на логине).
  it('фолбэк не заводит таймеров', async () => {
    const inner = { increment: jest.fn().mockRejectedValue(new Error('down')) }
    const storage = new ResilientThrottlerStorage(inner as unknown as ThrottlerStorage)
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

    for (let i = 0; i < 10; i++) await storage.increment('k', 60_000, 5, 0, 'default')

    expect(setTimeoutSpy).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
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
