import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { OpsNotifier } from '../../../common/monitoring'
import {
  QUEUE_NAMES,
  QUEUES,
  type QueueCounts,
  type QueueName,
  type QueueService,
} from '../../../common/queue'
import type { OpsStatusService } from '../ops-status.service'
import type { EnvVars } from '../../../config/env.schema'
import { QueuesCheck } from './queues.check'

// T-5 (docs/TELEGRAM_BOT.md §8): «рост failed → 🟡 с текстом последней ошибки».

const EMPTY: QueueCounts = { waiting: 0, active: 0, delayed: 0, failed: 0 }

function setup(counts: Partial<Record<QueueName, Partial<QueueCounts>>>, thresholds = {}) {
  const env: Partial<EnvVars> = {
    OPS_QUEUE_WAITING_THRESHOLD: 1000,
    OPS_QUEUE_FAILED_THRESHOLD: 20,
    ...thresholds,
  }
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const current = { ...counts }
  const queue = {
    lastFailedReason: jest.fn(async () => 'SMTP 550 отказ\n  at send (mailer.ts:1:1)'),
  }
  // Глубина очередей приходит из единого источника метрик (§7.1.5).
  const status = {
    queues: jest.fn(async () => QUEUE_NAMES.map((name) => ({ name, ...EMPTY, ...current[name] }))),
  }
  // База роста живёт в Redis (общая для реплик) — в тесте это обычная Map.
  const store = new Map<string, string>()
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  const check = new QueuesCheck(
    status as unknown as OpsStatusService,
    queue as unknown as QueueService,
    { get: jest.fn((key: keyof EnvVars) => env[key]) } as unknown as ConfigService<EnvVars, true>,
    redis as unknown as Redis,
    ops,
  )
  return { check, ops, queue, current, store, status, redis }
}

describe('QueuesCheck', () => {
  it('глубина выше порога — 🟡 с именем очереди и числом в ожидании', async () => {
    const { check, ops } = setup({ [QUEUES.EMAIL]: { waiting: 1500 } })

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('queueBacklog', { queue: 'email', waiting: 1500 })
  })

  it('глубина ниже порога — молчим', async () => {
    const { check, ops } = setup({ [QUEUES.EMAIL]: { waiting: 999 } })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('первая проверка задаёт базу: накопленные failed сами по себе не новость', async () => {
    const { check, ops } = setup({ [QUEUES.EMAIL]: { failed: 500 } })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('рост failed сверх порога — 🟡 с первой строкой последней ошибки', async () => {
    const { check, ops, current } = setup({ [QUEUES.EMAIL]: { failed: 500 } })
    await check.run()

    current[QUEUES.EMAIL] = { failed: 530 }
    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('queueFailing', {
      queue: 'email',
      failed: '+30 (всего 530)',
      lastError: 'SMTP 550 отказ',
    })
  })

  it('база общая для реплик — лежит в Redis, а не в памяти процесса', async () => {
    const { check, store } = setup({ [QUEUES.EMAIL]: { failed: 42 } })

    await check.run()

    expect(store.get('ops:queue:failed:email')).toBe('42')
  })

  it('рост в пределах порога — молчим', async () => {
    const { check, ops, current } = setup({ [QUEUES.EMAIL]: { failed: 500 } })
    await check.run()

    current[QUEUES.EMAIL] = { failed: 505 }
    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('собственную очередь не проверяем — о её заторе пришлось бы сообщать через неё же', async () => {
    const { check, ops } = setup({ [QUEUES.OPS_NOTIFY]: { waiting: 9999 } })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('сбой на одной очереди не скрывает остальные', async () => {
    const { check, ops, redis } = setup({ [QUEUES.NOTIFICATIONS]: { waiting: 5000 } })
    // Первая по списку очередь (email) спотыкается на чтении базы роста.
    redis.get.mockRejectedValueOnce(new Error('Redis лёг'))

    await expect(check.run()).resolves.toBeUndefined()
    expect(ops.emit).toHaveBeenCalledWith(
      'queueBacklog',
      expect.objectContaining({ queue: 'notifications' }),
    )
  })
})
