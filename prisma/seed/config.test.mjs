// Конфигурация и гарды. Главный из них — запрет большого масштаба на нелокальной БД:
// 80 млн строк, случайно залитые в Railway, стоят денег и часов.

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { loadConfig } from './config.mjs'

const LOCAL = 'postgresql://u:p@localhost:5432/studenthub'
const REMOTE = 'postgresql://u:p@containers-us-west-1.railway.app:5432/railway'

function withEnv(vars, fn) {
  const saved = { ...process.env }
  Object.assign(process.env, vars)
  try {
    return fn()
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
}

afterEach(() => {
  delete process.env.SEED_SCALE
  delete process.env.SEED_ONLY
})

describe('конфигурация сида', () => {
  it('по умолчанию профиль demo и генератор вузов выключен', () => {
    const config = withEnv({ DATABASE_URL: LOCAL }, loadConfig)
    assert.equal(config.scale, 'demo')
    assert.equal(config.universities, 0)
    assert.equal(config.media, false, 'demo не должен тянуть медиа из сети')
  })

  it('профиль full — 100 вузов по 700–1700 студентов и медиа включено', () => {
    const config = withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'full' }, loadConfig)
    assert.equal(config.universities, 100)
    assert.deepEqual([config.studentsMin, config.studentsMax], [700, 1700])
    assert.equal(config.media, true)
  })

  it('объёмы контента на пользователя — как заказано', () => {
    const config = withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'full' }, loadConfig)
    assert.deepEqual(config.postsPerUser, [20, 100])
    assert.deepEqual(config.articlesPerUser, [20, 50])
    assert.deepEqual(config.pollsPerUser, [10, 100])
  })

  it('большой масштаб на нелокальной БД заблокирован', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: REMOTE, SEED_SCALE: 'full' }, loadConfig),
      /нелокальной БД заблокирован/,
    )
  })

  it('SEED_ALLOW_REMOTE снимает блокировку осознанно', () => {
    const config = withEnv(
      { DATABASE_URL: REMOTE, SEED_SCALE: 'full', SEED_ALLOW_REMOTE: '1' },
      loadConfig,
    )
    assert.equal(config.universities, 100)
  })

  it('demo на нелокальной БД разрешён — им разворачивают прод', () => {
    const config = withEnv({ DATABASE_URL: REMOTE }, loadConfig)
    assert.equal(config.scale, 'demo')
  })

  it('неизвестный профиль и неизвестный этап отвергаются с подсказкой', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'nope' }, loadConfig),
      /Доступно/,
    )
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_ONLY: 'chats' }, loadConfig),
      /неизвестные этапы/,
    )
  })

  it('перевёрнутые диапазоны отвергаются', () => {
    assert.throws(
      () =>
        withEnv({ DATABASE_URL: LOCAL, SEED_POSTS_MIN: '50', SEED_POSTS_MAX: '10' }, loadConfig),
      /SEED_POSTS_MIN больше SEED_POSTS_MAX/,
    )
    assert.throws(
      () =>
        withEnv(
          { DATABASE_URL: LOCAL, SEED_STUDENTS_MIN: '900', SEED_STUDENTS_MAX: '100' },
          loadConfig,
        ),
      /SEED_STUDENTS_MIN больше/,
    )
  })

  it('SEED_ONLY ограничивает этапы, без него выполняются все', () => {
    const only = withEnv({ DATABASE_URL: LOCAL, SEED_ONLY: 'kato,media' }, loadConfig)
    assert.equal(only.runs('kato'), true)
    assert.equal(only.runs('universities'), false)
    const all = withEnv({ DATABASE_URL: LOCAL }, loadConfig)
    assert.equal(all.runs('universities'), true)
  })

  it('диапазон вузов вне 1..N отвергается', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'full', SEED_TO: '200' }, loadConfig),
      /вне 1\.\.100/,
    )
  })
})
