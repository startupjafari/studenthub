// Конфигурация мега-сида: профили масштаба, точечные переключатели и гарды.
//
// Зачем профили: `pnpm db:seed` гоняется в CI, в workflow «Seed (Railway)» и локально
// при каждом ресете БД. Полный масштаб (100 вузов ≈ 16 млн строк, десятки минут) там
// недопустим, поэтому по умолчанию сид остаётся демо-объёма, а 100 вузов включаются
// осознанно: `SEED_SCALE=full pnpm db:seed`.
//
// Все значения читаются один раз на старте и дальше передаются шагам как объект —
// шаги не лезут в process.env сами (иначе конфиг сида не воспроизвести по логу).

// Профили. students — диапазон студентов на вуз, из него PRNG берёт число для каждого
// вуза (детерминированно по индексу вуза, см. lib/rng.mjs).
// Этапы, которые можно выбрать через SEED_ONLY.
const STAGE_LIST = ['kato', 'media', 'companies', 'universities', 'demo']

const PROFILES = {
  // demo: генератор вузов выключен — заливается только демо-вуз основного сида.
  demo: { universities: 0, students: [340, 380], label: 'демо (текущий объём)' },
  small: { universities: 5, students: [200, 400], label: 'малый (мультивузовость)' },
  full: { universities: 100, students: [700, 1700], label: 'полный' },
}

function num(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${name}: ожидалось число, получено "${raw}"`)
  return value
}

function bool(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return raw !== '0' && raw.toLowerCase() !== 'false'
}

function list(name) {
  const raw = process.env[name]
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Локальная БД — это localhost/127.0.0.1/::1 или сокет. Всё остальное считаем удалённым:
// заливать туда 16 млн строк без явного согласия нельзя (тариф Railway, время прогона).
function isLocalDatabase(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
  } catch {
    return false
  }
}

export function loadConfig() {
  const scaleName = process.env.SEED_SCALE ?? 'demo'
  const profile = PROFILES[scaleName]
  if (!profile) {
    throw new Error(
      `SEED_SCALE="${scaleName}" неизвестен. Доступно: ${Object.keys(PROFILES).join(', ')}`,
    )
  }

  const universities = num('SEED_UNIVERSITIES', profile.universities)
  const config = {
    scale: scaleName,
    scaleLabel: profile.label,
    universities,
    studentsMin: num('SEED_STUDENTS_MIN', profile.students[0]),
    studentsMax: num('SEED_STUDENTS_MAX', profile.students[1]),
    // Диапазон вузов для догенерации порциями: SEED_FROM=20 SEED_TO=40.
    from: num('SEED_FROM', 1),
    to: num('SEED_TO', universities),
    // Сколько вузов генерировать параллельно. Больше 8 упирается в пул соединений Prisma.
    concurrency: num('SEED_CONCURRENCY', 4),
    // Размер чанка createMany. 2000 — компромисс между числом round-trip'ов и размером запроса.
    chunkSize: num('SEED_CHUNK', 2000),
    // Только перечисленные этапы: SEED_ONLY=media или SEED_ONLY=companies,universities.
    //
    // Гранулярность — этап, а не отдельный шаг вуза: шаги внутри вуза передают друг
    // другу структуру и людей по памяти (структура → люди → академика → контент), и
    // запустить «только чаты» без генерации остального нельзя — их не к чему привязать.
    // Демо-вуз основного сида заливается всегда: он идемпотентен и занимает секунды.
    only: list('SEED_ONLY'),
    // Пересоздать данные вузов, помеченных как готовые (см. lib/marker.mjs).
    force: bool('SEED_FORCE', false),
    // Медиа по умолчанию только на больших профилях: `pnpm db:seed` в demo не должен
    // неожиданно тянуть из сети полгигабайта фото и видео (и требовать поднятый MinIO).
    // Включить для demo — SEED_MEDIA=1, выключить где угодно — SEED_MEDIA=0.
    media: bool('SEED_MEDIA', scaleName !== 'demo'),
    // Фото — 1000 уникальных (требование задачи). Видео — «сколько есть, но все
    // разные»: без API-ключа тысячу уникальных роликов не собрать, поэтому здесь
    // потолок, а фактическое число зависит от доступности источников.
    photos: num('SEED_PHOTOS', 1000),
    videos: num('SEED_VIDEOS', 150),
    // ── Контент на пользователя ───────────────────────────────────────────────
    // Объём здесь определяет почти весь размер БД: 60 постов × 130 тыс.
    // пользователей — это 7.8 млн постов, а опросы с вариантами и голосами дают
    // ещё десятки миллионов строк. Значения по умолчанию — как заказано.
    postsPerUser: [num('SEED_POSTS_MIN', 20), num('SEED_POSTS_MAX', 100)],
    articlesPerUser: [num('SEED_ARTICLES_MIN', 20), num('SEED_ARTICLES_MAX', 50)],
    pollsPerUser: [num('SEED_POLLS_MIN', 10), num('SEED_POLLS_MAX', 100)],
    // Голосов на опрос: множитель к самому большому домену. 3 голоса на опрос при
    // 7.2 млн опросов — это ещё ~11 млн строк.
    pollVotesMax: num('SEED_POLL_VOTES_MAX', 3),
    // Постов с изображением на пользователя. Картинка требует объекта в MinIO
    // (File.postId эксклюзивен, объект уникален по bucket+key), поэтому «картинка у
    // каждого поста» = 7.8 млн объектов и сотни гигабайт. Здесь — серверные копии
    // уже скачанных фото: 2 на пользователя ≈ 260 тыс. объектов ≈ 9 ГБ. 0 — выключить.
    postImagesPerUser: num('SEED_POST_IMAGES_PER_USER', 2),
    // Кэш скачанного (в .gitignore): повторный прогон не тянет файлы из сети заново.
    mediaDir: process.env.SEED_MEDIA_DIR ?? '.seed-media',
    // Заново обойти Викисклад в поисках видео (иначе берётся кэш индекса).
    mediaRefresh: bool('SEED_MEDIA_REFRESH', false),
    allowRemote: bool('SEED_ALLOW_REMOTE', false),
    databaseUrl: process.env.DATABASE_URL ?? '',
  }

  const unknown = (config.only ?? []).filter((stage) => !STAGE_LIST.includes(stage))
  if (unknown.length > 0) {
    throw new Error(
      `SEED_ONLY: неизвестные этапы ${unknown.join(', ')}. Доступно: ${STAGE_LIST.join(', ')}`,
    )
  }
  // Удобный предикат для точки входа: без SEED_ONLY выполняются все этапы.
  config.runs = (stage) => config.only === null || config.only.includes(stage)

  if (config.studentsMin > config.studentsMax) {
    throw new Error('SEED_STUDENTS_MIN больше SEED_STUDENTS_MAX')
  }
  for (const [name, range] of [
    ['SEED_POSTS', config.postsPerUser],
    ['SEED_ARTICLES', config.articlesPerUser],
    ['SEED_POLLS', config.pollsPerUser],
  ]) {
    if (range[0] > range[1]) throw new Error(`${name}_MIN больше ${name}_MAX`)
    if (range[0] < 0) throw new Error(`${name}_MIN отрицательный`)
  }
  if (
    config.universities > 0 &&
    (config.from < 1 || config.to > config.universities || config.from > config.to)
  ) {
    throw new Error(
      `Диапазон SEED_FROM=${config.from}..SEED_TO=${config.to} вне 1..${config.universities}`,
    )
  }
  if (scaleName !== 'demo' && !config.allowRemote && !isLocalDatabase(config.databaseUrl)) {
    throw new Error(
      `Масштаб "${scaleName}" на нелокальной БД заблокирован: это миллионы строк и десятки минут.\n` +
        'Если это действительно нужно — SEED_ALLOW_REMOTE=1.',
    )
  }

  return config
}

export { PROFILES, STAGE_LIST, isLocalDatabase }
