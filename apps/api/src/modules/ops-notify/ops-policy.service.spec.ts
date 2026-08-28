import type Redis from 'ioredis'
import type { OpsEventSpec } from '../../common/monitoring'
import type { QueueService } from '../../common/queue'
import { OpsPolicyService } from './ops-policy.service'

// Мок Redis на Map: TTL не эмулируем — окна проверяются логикой, а не часами.
// `set(..., 'NX')` обязан вести себя как в Redis, иначе тест дедупликации ничего не значит.
function makeRedis() {
  const store = new Map<string, string>()
  const hashes = new Map<string, Record<string, string>>()
  return {
    store,
    hashes,
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => {
      const had = store.delete(key) || hashes.delete(key)
      return had ? 1 : 0
    }),
    incr: jest.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1
      store.set(key, String(next))
      return next
    }),
    expire: jest.fn(async () => 1),
    hincrby: jest.fn(async (key: string, field: string, by: number) => {
      const hash = hashes.get(key) ?? {}
      hash[field] = String(Number(hash[field] ?? 0) + by)
      hashes.set(key, hash)
      return Number(hash[field])
    }),
    hgetall: jest.fn(async (key: string) => hashes.get(key) ?? {}),
  }
}

function setup() {
  const redis = makeRedis()
  const queue = { enqueue: jest.fn(async () => undefined) }
  const service = new OpsPolicyService(redis as unknown as Redis, queue as unknown as QueueService)
  return { service, redis, queue }
}

const cronFailed: OpsEventSpec = {
  topic: 'alerts',
  status: 'error',
  title: 'Cron {job} упал',
  dedupe: ['job'],
  dedupeTtl: 600,
}

const drift: OpsEventSpec = {
  topic: 'digest',
  status: 'warn',
  title: 'Дрейф веток',
  throttle: { max: 2, windowSec: 3600 },
}

// Имена событий в реестре типизированы, но политике важна только спека — в тестах
// приводим строку к нужному типу, чтобы не заводить фиктивные записи в реестре.
const name = (value: string) => value as never

describe('OpsPolicyService', () => {
  describe('дедупликация', () => {
    it('одна и та же авария в пределах окна = одно сообщение', async () => {
      const { service } = setup()

      const first = await service.allow(name('cronFailed'), cronFailed, { job: 'publishPosts' })
      const second = await service.allow(name('cronFailed'), cronFailed, { job: 'publishPosts' })

      expect(first).toBe(true)
      expect(second).toBe(false)
    })

    it('другая задача — другой ключ, сообщение проходит', async () => {
      const { service } = setup()
      await service.allow(name('cronFailed'), cronFailed, { job: 'publishPosts' })

      expect(await service.allow(name('cronFailed'), cronFailed, { job: 'expireInvites' })).toBe(
        true,
      )
    })

    it('без dedupeTtl дедупликации нет вовсе', async () => {
      const { service } = setup()
      const spec: OpsEventSpec = { ...cronFailed, dedupeTtl: 0 }

      expect(await service.allow(name('x'), spec, { job: 'a' })).toBe(true)
      expect(await service.allow(name('x'), spec, { job: 'a' })).toBe(true)
    })
  })

  describe('троттлинг', () => {
    it('потолок за окно: сверх максимума событие придерживается', async () => {
      const { service } = setup()

      expect(await service.allow(name('drift'), drift, {})).toBe(true)
      expect(await service.allow(name('drift'), drift, {})).toBe(true)
      expect(await service.allow(name('drift'), drift, {})).toBe(false)
    })

    it('окно выставляется один раз — на первом событии', async () => {
      const { service, redis } = setup()

      await service.allow(name('drift'), drift, {})
      await service.allow(name('drift'), drift, {})

      expect(redis.expire).toHaveBeenCalledTimes(1)
    })
  })

  describe('тишина', () => {
    it('приглушает всё, кроме 🔴', async () => {
      const { service } = setup()
      await service.startQuiet(60_000)

      expect(await service.allow(name('drift'), drift, {})).toBe(false)
      expect(await service.allow(name('cronFailed'), cronFailed, { job: 'a' })).toBe(true)
    })

    it('ставит отложенный job на снятие — таймер в процессе не пережил бы рестарт', async () => {
      const { service, queue } = setup()

      await service.startQuiet(60_000)

      expect(queue.enqueue).toHaveBeenCalledTimes(1)
    })

    it('заглушённые события не теряются: сводка считает все и отдельно красные', async () => {
      const { service } = setup()
      await service.startQuiet(60_000)
      await service.allow(name('drift'), drift, {})
      await service.allow(name('cronFailed'), cronFailed, { job: 'a' })

      expect(await service.endQuiet()).toEqual({ total: 2, red: 1 })
    })

    it('сводку отдаёт ровно один раз — второй инстанс получит null', async () => {
      const { service } = setup()
      await service.startQuiet(60_000)

      expect(await service.endQuiet()).not.toBeNull()
      expect(await service.endQuiet()).toBeNull()
    })

    it('истёкшая тишина больше не глушит', async () => {
      const { service } = setup()
      await service.startQuiet(-1)

      expect(await service.quietUntil()).toBeNull()
      expect(await service.allow(name('drift'), drift, {})).toBe(true)
    })
  })

  describe('гистерезис проверок по расписанию', () => {
    it('первое наблюдение «всё хорошо» фиксируется молча', async () => {
      const { service } = setup()

      expect(await service.transitioned('dep:redis', 'up', 'up')).toBe(false)
    })

    it('авария подтверждается двумя наблюдениями подряд, а не первым', async () => {
      const { service } = setup()
      await service.transitioned('dep:redis', 'up', 'up')

      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(false)
      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(true)
    })

    it('мигание up → down → up не звенит: счётчик привязан к состоянию-кандидату', async () => {
      const { service } = setup()
      await service.transitioned('dep:redis', 'up', 'up')

      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(false)
      expect(await service.transitioned('dep:redis', 'up', 'up')).toBe(false)
      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(false)
    })

    it('пока состояние держится, сообщение не повторяется', async () => {
      const { service } = setup()
      await service.transitioned('dep:redis', 'down', 'up')
      await service.transitioned('dep:redis', 'down', 'up')

      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(false)
    })

    it('«выздоровление» — отдельное срабатывание', async () => {
      const { service } = setup()
      await service.transitioned('dep:redis', 'down', 'up')
      await service.transitioned('dep:redis', 'down', 'up')

      expect(await service.transitioned('dep:redis', 'up', 'up')).toBe(false)
      expect(await service.transitioned('dep:redis', 'up', 'up')).toBe(true)
    })

    it('confirmations = 1 сообщает сразу: «пропущено два окна» само по себе гистерезис', async () => {
      const { service } = setup()

      expect(await service.transitioned('cron:posts', 'silent', 'ok', 1)).toBe(true)
    })

    it('недоступный Redis молчит, а не звенит на каждой проверке', async () => {
      const { service, redis } = setup()
      redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      expect(await service.transitioned('dep:redis', 'down', 'up')).toBe(false)
    })
  })

  it('недоступный Redis не глотает событие (fail-open): потерянный алерт хуже лишнего', async () => {
    const { service, redis } = setup()
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    expect(await service.allow(name('cronFailed'), cronFailed, { job: 'a' })).toBe(true)
  })
})
