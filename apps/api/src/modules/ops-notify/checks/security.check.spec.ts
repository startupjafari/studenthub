import type { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import type { AuditService } from '../../../common/audit/audit.service'
import type { OpsNotifier } from '../../../common/monitoring'
import type { AuthFailureWindow, HttpStatusCounter } from '../../../common/monitoring'
import type { EnvVars } from '../../../config/env.schema'
import { SecurityCheck } from './security.check'

// T-12 (docs/TELEGRAM_BOT.md §8): «Агрегаты по окну; из аудита — только тип действия и id».

type AuditEntry = { action: string; entityId: string | null; createdAt: Date }

function setup(
  window: Partial<AuthFailureWindow> = {},
  entries: AuditEntry[] = [],
  initial: Record<string, string> = {},
) {
  const store = new Map<string, string>(Object.entries(initial))
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  const statusCounter = {
    authFailures: jest.fn(async () => ({
      total: 0,
      throttled: 0,
      distinctIps: 0,
      windowMinutes: 5,
      ...window,
    })),
  }
  const audit = {
    recentSensitive: jest.fn(
      async (_actions: readonly string[], _since: Date, _take: number) => entries,
    ),
  }
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
  }
  const check = new SecurityCheck(
    statusCounter as unknown as HttpStatusCounter,
    audit as unknown as AuditService,
    {
      get: jest.fn(() => 50),
    } as unknown as ConfigService<EnvVars, true>,
    redis as unknown as Redis,
    ops,
  )
  return { check, ops, audit, store }
}

const entry = (action: string, entityId = 'u-1'): AuditEntry => ({
  action,
  entityId,
  createdAt: new Date('2026-08-28T20:00:00Z'),
})

describe('SecurityCheck — всплеск отказов', () => {
  it('ниже порога — молчим: несколько опечаток в пароле не инцидент', async () => {
    const { check, ops } = setup({ total: 49 })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalledWith('authFailureSpike', expect.anything())
  })

  it('выше порога — агрегат: сколько, за какое окно, сколько разных IP', async () => {
    const { check, ops } = setup({ total: 320, distinctIps: 4, throttled: 61 })

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('authFailureSpike', {
      total: 320,
      window: '5 мин',
      ips: 4,
      throttled: 61,
    })
  })
})

describe('SecurityCheck — админские действия', () => {
  it('первый запуск задаёт границу и молчит — иначе уехала бы вся история', async () => {
    const { check, ops, audit, store } = setup({}, [entry('user_blocked')])

    await check.run()

    expect(audit.recentSensitive).not.toHaveBeenCalled()
    expect(ops.emit).not.toHaveBeenCalled()
    expect(store.has('ops:security:audit-since')).toBe(true)
  })

  it('одно сообщение на окно, а не строка на находку', async () => {
    const { check, ops } = setup(
      {},
      [entry('user_blocked', 'u-1'), entry('user_blocked', 'u-2'), entry('invite_revoked', 'i-9')],
      { 'ops:security:audit-since': '2026-08-28T19:00:00.000Z' },
    )

    await check.run()

    expect(ops.emit).toHaveBeenCalledTimes(1)
    expect(ops.emit).toHaveBeenCalledWith('adminActions', {
      count: 3,
      actions: 'user_blocked ×2, invite_revoked',
      sample: 'u-1',
    })
  })

  it('в сообщение уходят только типы действий и id — ни ФИО, ни email', async () => {
    const { check, ops } = setup({}, [entry('moderator_chat_access', 'c-7')], {
      'ops:security:audit-since': '2026-08-28T19:00:00.000Z',
    })

    await check.run()

    const payload = ops.emit.mock.calls[0]?.[1] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['actions', 'count', 'sample'])
  })

  it('граница берётся из Redis, а не «минус пять минут»: пропуск такта ничего не теряет', async () => {
    const since = '2026-08-28T18:00:00.000Z'
    const { check, audit } = setup({}, [entry('user_blocked')], {
      'ops:security:audit-since': since,
    })

    await check.run()

    expect(audit.recentSensitive.mock.calls[0]?.[1]).toEqual(new Date(since))
  })

  it('ничего не происходило — канал молчит', async () => {
    const { check, ops } = setup({}, [], {
      'ops:security:audit-since': '2026-08-28T19:00:00.000Z',
    })

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })
})
