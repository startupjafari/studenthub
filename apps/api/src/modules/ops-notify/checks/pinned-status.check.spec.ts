import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { EnvVars } from '../../../config/env.schema'
import { OpsMessageBuilder } from '../ops-message.builder'
import type { OpsStatusService, OpsStatusSnapshot } from '../ops-status.service'
import type { TelegramOpsService } from '../telegram-ops.service'
import { PinnedStatusCheck } from './pinned-status.check'

// T-10 (docs/TELEGRAM_BOT.md §8): «обновляется раз в 5 минут и после деплоя, без уведомлений;
// не изменилось — не редактируется».

function snapshot(overrides: Partial<OpsStatusSnapshot> = {}): OpsStatusSnapshot {
  return {
    release: '2c7a86e',
    uptimeMs: 3 * 60 * 60_000,
    dependencies: [
      { name: 'postgres', up: true, reason: '' },
      { name: 'redis', up: true, reason: '' },
      { name: 'minio', up: true, reason: '' },
    ],
    queues: [{ name: 'email', waiting: 0, active: 0, delayed: 0, failed: 0 }],
    checkedAt: new Date('2026-08-28T21:05:00Z'),
    ...overrides,
  }
}

function setup(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const redis = {
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    mset: jest.fn(async (...pairs: string[]) => {
      for (let i = 0; i < pairs.length; i += 2) {
        store.set(pairs[i] as string, pairs[i + 1] as string)
      }
      return 'OK'
    }),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  const telegram = {
    send: jest.fn(async (_message: unknown) => 42 as number | null),
    edit: jest.fn(async () => 'ok' as const),
    pin: jest.fn(async () => true),
  }
  const current = { value: snapshot() }
  const status = { snapshot: jest.fn(async () => current.value) }
  const builder = new OpsMessageBuilder({
    get: jest.fn(() => undefined),
  } as unknown as ConfigService<EnvVars, true>)

  const check = new PinnedStatusCheck(
    status as unknown as OpsStatusService,
    builder,
    telegram as unknown as TelegramOpsService,
    redis as unknown as Redis,
  )
  return { check, telegram, store, current, builder }
}

describe('PinnedStatusCheck', () => {
  it('первый запуск: отправляет и закрепляет, запоминая message_id', async () => {
    const { check, telegram, store } = setup()

    await check.run()

    expect(telegram.send).toHaveBeenCalledTimes(1)
    expect(telegram.pin).toHaveBeenCalledWith(42)
    expect(store.get('ops:pinned:message-id')).toBe('42')
  })

  it('отправляется без звука — закреплённое не должно будить (§3.3)', async () => {
    const { check, telegram } = setup()

    await check.run()

    expect(telegram.send.mock.calls[0]?.[0]).toMatchObject({ silent: true })
  })

  it('содержимое не изменилось — не редактируем вовсе', async () => {
    const { check, telegram } = setup()
    await check.run()
    telegram.edit.mockClear()

    await check.run()

    expect(telegram.edit).not.toHaveBeenCalled()
  })

  it('сменившееся время «обновлено» правкой не считается', async () => {
    const { check, telegram, current } = setup()
    await check.run()

    current.value = snapshot({ checkedAt: new Date('2026-08-28T21:10:00Z') })
    await check.run()

    expect(telegram.edit).not.toHaveBeenCalled()
  })

  it('изменилось состояние — правим то же сообщение, а не шлём новое', async () => {
    const { check, telegram, current } = setup()
    await check.run()

    current.value = snapshot({
      dependencies: [{ name: 'redis', up: false, reason: 'ECONNREFUSED' }],
    })
    await check.run()

    expect(telegram.edit).toHaveBeenCalledWith(42, expect.anything())
    expect(telegram.send).toHaveBeenCalledTimes(1)
  })

  it('message_id переживает рестарт: берётся из Redis, а не из памяти', async () => {
    const { check, telegram } = setup({ 'ops:pinned:message-id': '7' })

    await check.run()

    expect(telegram.edit).toHaveBeenCalledWith(7, expect.anything())
    expect(telegram.send).not.toHaveBeenCalled()
  })

  it('сеть моргнула — не плодим второй «статус», ждём следующей проверки', async () => {
    const { check, telegram } = setup({ 'ops:pinned:message-id': '7' })
    telegram.edit.mockResolvedValueOnce('failed' as never)

    await check.run()

    expect(telegram.send).not.toHaveBeenCalled()
  })

  it('сообщение удалили — публикуем и закрепляем новое', async () => {
    const { check, telegram, store } = setup({ 'ops:pinned:message-id': '7' })
    telegram.edit.mockResolvedValueOnce('gone' as never)

    await check.run()

    expect(telegram.send).toHaveBeenCalledTimes(1)
    expect(store.get('ops:pinned:message-id')).toBe('42')
  })

  it('отправка не удалась — id не запоминаем, иначе правили бы несуществующее', async () => {
    const { check, telegram, store } = setup()
    telegram.send.mockResolvedValueOnce(null as never)

    await check.run()

    expect(store.has('ops:pinned:message-id')).toBe(false)
    expect(telegram.pin).not.toHaveBeenCalled()
  })
})
