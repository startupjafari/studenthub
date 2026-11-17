// Конфигурация и гарды. Главный из них — запрет вузов генератора на нелокальной БД:
// миллионы строк, случайно залитые в Railway, стоят денег и часов.

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { activityLevel, activityOf, averageOf, pollTurnout } from './lib/activity.mjs'
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
  delete process.env.SEED_ONLY
})

describe('конфигурация сида', () => {
  it('по умолчанию — только демо-вуз, без медиа', () => {
    const config = withEnv({ DATABASE_URL: LOCAL }, loadConfig)
    assert.equal(config.universities, 0)
    assert.equal(config.demoUniversity, true)
    assert.equal(config.media, false, 'один демо-вуз не должен тянуть медиа из сети')
  })

  it('объём — число вузов и студентов; медиа включается вместе с вузами', () => {
    const config = withEnv(
      { DATABASE_URL: LOCAL, SEED_UNIVERSITIES: '4', SEED_STUDENTS: '500-1000' },
      loadConfig,
    )
    assert.equal(config.universities, 4)
    assert.deepEqual([config.studentsMin, config.studentsMax], [500, 1000])
    assert.equal(config.media, true)
    assert.equal(config.to, 4)
  })

  it('студентов по умолчанию — средний вуз, одно число — ровно столько', () => {
    const def = withEnv({ DATABASE_URL: LOCAL, SEED_UNIVERSITIES: '1' }, loadConfig)
    assert.deepEqual([def.studentsMin, def.studentsMax], [500, 1000])
    const exact = withEnv(
      { DATABASE_URL: LOCAL, SEED_UNIVERSITIES: '1', SEED_STUDENTS: '1450' },
      loadConfig,
    )
    assert.deepEqual([exact.studentsMin, exact.studentsMax], [1450, 1450])
  })

  it('удалённые ручки и профили не игнорируются молча', () => {
    for (const name of ['SEED_SCALE', 'SEED_POSTS', 'SEED_PHOTOS_PER_USER', 'SEED_FACULTIES']) {
      assert.throws(
        () => withEnv({ DATABASE_URL: LOCAL, [name]: '1' }, loadConfig),
        new RegExp(name),
        `${name} должен отвергаться`,
      )
    }
  })

  it('вузы генератора на нелокальной БД заблокированы', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: REMOTE, SEED_UNIVERSITIES: '2' }, loadConfig),
      /нелокальной БД заблокировано/,
    )
  })

  it('SEED_ALLOW_REMOTE снимает блокировку осознанно', () => {
    const config = withEnv(
      { DATABASE_URL: REMOTE, SEED_UNIVERSITIES: '2', SEED_ALLOW_REMOTE: '1' },
      loadConfig,
    )
    assert.equal(config.universities, 2)
  })

  it('один демо-вуз на нелокальной БД разрешён — им разворачивают прод', () => {
    const config = withEnv({ DATABASE_URL: REMOTE }, loadConfig)
    assert.equal(config.universities, 0)
  })

  it('неизвестный этап отвергается с подсказкой', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_ONLY: 'chats' }, loadConfig),
      /неизвестные этапы/,
    )
  })

  it('перевёрнутый и мусорный диапазон студентов отвергается', () => {
    assert.throws(
      () =>
        withEnv(
          { DATABASE_URL: LOCAL, SEED_STUDENTS_MIN: '900', SEED_STUDENTS_MAX: '100' },
          loadConfig,
        ),
      /SEED_STUDENTS: минимум 900 больше максимума 100/,
    )
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_STUDENTS: '10..20' }, loadConfig),
      /SEED_STUDENTS: ожидалось «A-B» или число/,
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
      () => withEnv({ DATABASE_URL: LOCAL, SEED_UNIVERSITIES: '4', SEED_TO: '200' }, loadConfig),
      /вне 1\.\.4/,
    )
  })
})

// Объём контента — от роли и активности человека, а не от ручек «на пользователя».
describe('нормы активности (lib/activity.mjs)', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `u001-st-${i}`)

  it('активность детерминирована: тот же id — те же числа', () => {
    assert.deepEqual(activityOf('u001-st-7', 'STUDENT'), activityOf('u001-st-7', 'STUDENT'))
  })

  it('уровни распределяются примерно 30 / 50 / 20', () => {
    const counts = { passive: 0, regular: 0, active: 0 }
    for (const id of ids) counts[activityLevel(id).name] += 1
    assert.ok(Math.abs(counts.passive / ids.length - 0.3) < 0.05)
    assert.ok(Math.abs(counts.regular / ids.length - 0.5) < 0.05)
    assert.ok(Math.abs(counts.active / ids.length - 0.2) < 0.05)
  })

  it('официальные аккаунты пишут больше студентов, охрана — почти ничего', () => {
    assert.ok(averageOf('UNIVERSITY_ADMIN', 'posts') > averageOf('STAROSTA', 'posts'))
    assert.ok(averageOf('STAROSTA', 'posts') > averageOf('STUDENT', 'posts'))
    assert.equal(averageOf('SECURITY_GUARD', 'posts'), 0)
  })

  it('средний студент близок к норме роли', () => {
    const mean = ids.reduce((sum, id) => sum + activityOf(id, 'STUDENT').posts, 0) / ids.length
    assert.ok(Math.abs(mean - averageOf('STUDENT', 'posts')) < 0.5, `среднее ${mean}`)
  })

  it('у пишущего хотя бы один пост с медиа, у молчащего — ни одного', () => {
    for (const id of ids) {
      const a = activityOf(id, 'STUDENT')
      assert.equal(a.postMedia === 0, a.posts === 0)
      assert.ok(a.postMedia <= a.posts)
    }
  })

  it('явка в опросе — от 20 до 60 % аудитории', () => {
    for (const id of ids.slice(0, 200)) {
      const votes = pollTurnout(id, 24)
      assert.ok(votes >= Math.round(24 * 0.2) && votes <= Math.round(24 * 0.6))
    }
  })
})

// Прогон идёт по той же базе, что у прода: уборка возможна только прицельная, по метке.
describe('loadConfig: режим и метка прогона', () => {
  it('по умолчанию это обычный прогон без метки', () => {
    const c = withEnv({ DATABASE_URL: LOCAL }, loadConfig)
    assert.equal(c.mode, 'seed')
    assert.equal(c.tag, '')
  })

  it('cleanup без метки отвергается: удалять нечего и опасно', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_MODE: 'cleanup' }, loadConfig),
      /SEED_MODE=cleanup требует SEED_TAG/,
    )
  })

  it('неизвестный режим отвергается', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_MODE: 'reset' }, loadConfig),
      /SEED_MODE="reset" неизвестен/,
    )
  })

  it('потолки объёма читаются из окружения', () => {
    const c = withEnv(
      { DATABASE_URL: LOCAL, SEED_MAX_ROWS_SOFT: '1000', SEED_MAX_ROWS_HARD: '2000' },
      loadConfig,
    )
    assert.equal(c.maxRowsSoft, 1000)
    assert.equal(c.maxRowsHard, 2000)
  })
})
