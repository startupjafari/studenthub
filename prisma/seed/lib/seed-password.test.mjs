// Пароль сид-аккаунтов: генерируется только там, где его можно показать запускающему,
// и никогда — в лог GitHub Actions.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEV_PASSWORD, resolveSeedPassword } from './seed-password.mjs'

const KEYS = ['SEED_PASSWORD', 'SEED_ALLOW_REMOTE', 'NODE_ENV', 'GITHUB_ACTIONS']

function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, vars)
  try {
    return fn()
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

describe('пароль сид-аккаунтов', () => {
  it('локально без SEED_PASSWORD — dev-умолчание', () => {
    const result = withEnv({}, resolveSeedPassword)
    assert.equal(result.password, DEV_PASSWORD)
    assert.equal(result.generated, false)
  })

  it('SEED_PASSWORD побеждает и в GitHub Actions', () => {
    const result = withEnv(
      { SEED_PASSWORD: ' secret-1A! ', SEED_ALLOW_REMOTE: '1', GITHUB_ACTIONS: 'true' },
      resolveSeedPassword,
    )
    assert.equal(result.password, 'secret-1A!')
    assert.equal(result.fromEnv, true)
  })

  it('удалённая база вне Actions — пароль генерируется', () => {
    const result = withEnv({ SEED_ALLOW_REMOTE: '1' }, resolveSeedPassword)
    assert.equal(result.generated, true)
    assert.notEqual(result.password, DEV_PASSWORD)
  })

  it('удалённая база в GitHub Actions без секрета — отказ, а не пароль в лог', () => {
    assert.throws(
      () => withEnv({ SEED_ALLOW_REMOTE: '1', GITHUB_ACTIONS: 'true' }, resolveSeedPassword),
      /SEED_PASSWORD не задан/,
    )
  })
})
