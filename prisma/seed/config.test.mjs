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

describe('профиль test (стенд по ТЗ)', () => {
  it('задаёт состав поимённо и выключает демо-вуз', () => {
    const c = withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'test' }, loadConfig)
    assert.equal(c.universities, 1)
    assert.equal(c.studentsMin, 1450)
    assert.equal(c.studentsMax, 1450)
    assert.equal(c.faculties, 2)
    assert.equal(c.teachers, 24)
    assert.equal(c.groupSize, 25)
    assert.equal(c.platformModerators, 2)
    // Демо-вуз «Алатау» здесь не заливается: требование ТЗ — ровно один университет.
    assert.equal(c.demoUniversity, false)
    // Пул нужен и при пустой галерее: из него идут аватары, обложки и картинки постов.
    assert.equal(c.photos, 200)
    assert.equal(c.videos, 50)
    // Личная галерея пустая (решение пользователя): 100 фото на каждого стоили бы
    // ~29 ГБ в MinIO — 29 из 30 ГБ всего стенда.
    assert.equal(c.photosPerUser, 0)
    assert.equal(c.videosPerUser, 0)
  })

  it('галерею можно включить ручкой, не трогая остальной состав', () => {
    const c = withEnv(
      { DATABASE_URL: LOCAL, SEED_SCALE: 'test', SEED_PHOTOS_PER_USER: '30', SEED_VIDEOS_PER_USER: '1' }, // prettier-ignore
      loadConfig,
    )
    assert.equal(c.photosPerUser, 30)
    assert.equal(c.videosPerUser, 1)
    assert.equal(c.studentsMin, 1450)
  })

  it('остальные профили состав не задают и демо-вуз оставляют', () => {
    for (const scale of ['demo', 'small', 'full']) {
      const c = withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: scale }, loadConfig)
      assert.equal(c.faculties, null, `${scale}: факультеты должны считаться формулой`)
      assert.equal(c.teachers, null, `${scale}: преподаватели — по нагрузке`)
      assert.equal(c.demoUniversity, true, `${scale}: демо-вуз остаётся`)
      assert.equal(c.photosPerUser, 0, `${scale}: личная галерея выключена`)
    }
  })

  it('факультет без единой группы отвергается до записи в БД', () => {
    assert.throws(
      () =>
        withEnv(
          { DATABASE_URL: LOCAL, SEED_SCALE: 'test', SEED_STUDENTS_MIN: '25', SEED_STUDENTS_MAX: '25' }, // prettier-ignore
          loadConfig,
        ),
      /Факультет без групп недопустим/,
    )
  })

  it('преподавателей не может быть меньше, чем факультетов', () => {
    assert.throws(
      () => withEnv({ DATABASE_URL: LOCAL, SEED_SCALE: 'test', SEED_TEACHERS: '1' }, loadConfig),
      /меньше числа факультетов/,
    )
  })
})
