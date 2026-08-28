import type { OpsNotifier } from '../../../common/monitoring'
import type { DependencyStatus, OpsStatusService } from '../ops-status.service'
import type { OpsPolicyService } from '../ops-policy.service'
import { DependenciesCheck } from './dependencies.check'

// T-6 (docs/TELEGRAM_BOT.md §8): «Сообщение на смену состояния, а не на каждую проверку;
// «выздоровление» отдельным 🟢».

const up = (name: string): DependencyStatus => ({ name, up: true, reason: '' })
const down = (name: string, reason: string): DependencyStatus => ({ name, up: false, reason })

/** Политика как настоящая: докладывает только о смене состояния (одного подтверждения хватит). */
function makePolicy() {
  const states = new Map<string, string>()
  return {
    transitioned: jest.fn(async (key: string, state: string, healthy: string) => {
      const previous = states.get(key)
      states.set(key, state)
      return previous === undefined ? state !== healthy : previous !== state
    }),
  }
}

function setup() {
  const ops: OpsNotifier & { emit: jest.Mock } = { emit: jest.fn() }
  // Вердикты приходят готовыми из OpsStatusService — проверка отвечает только за то,
  // стоит ли о них рассказывать.
  const results = { postgres: up('postgres'), redis: up('redis'), minio: up('minio') }
  const status = { dependencies: jest.fn(async () => Object.values(results)) }
  const check = new DependenciesCheck(
    status as unknown as OpsStatusService,
    makePolicy() as unknown as OpsPolicyService,
    ops,
  )
  return { check, ops, results, status }
}

describe('DependenciesCheck', () => {
  it('всё поднято — канал молчит', async () => {
    const { check, ops } = setup()

    await check.run()

    expect(ops.emit).not.toHaveBeenCalled()
  })

  it('деградация — 🔴 с именем зависимости и причиной', async () => {
    const { check, ops, results } = setup()
    results.redis = down('redis', 'ECONNREFUSED')

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('dependencyDown', {
      name: 'redis',
      reason: 'ECONNREFUSED',
    })
  })

  it('состояние не менялось — второй проверкой не повторяем', async () => {
    const { check, ops, results } = setup()
    results.redis = down('redis', 'ECONNREFUSED')

    await check.run()
    await check.run()

    expect(ops.emit).toHaveBeenCalledTimes(1)
  })

  it('«выздоровление» приходит отдельным 🟢', async () => {
    const { check, ops, results } = setup()
    results.redis = down('redis', 'ECONNREFUSED')
    await check.run()

    results.redis = up('redis')
    await check.run()

    expect(ops.emit).toHaveBeenLastCalledWith('dependencyUp', { name: 'redis' })
  })

  it('недоступность без описания всё равно объясняется человеку', async () => {
    const { check, ops, results } = setup()
    results.redis = down('redis', '')

    await check.run()

    expect(ops.emit).toHaveBeenCalledWith('dependencyDown', {
      name: 'redis',
      reason: 'нет ответа',
    })
  })
})
