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
    // Только перечисленные шаги: SEED_ONLY=media,chats.
    only: list('SEED_ONLY'),
    // Пересоздать данные вузов, помеченных как готовые (см. lib/marker.mjs).
    force: bool('SEED_FORCE', false),
    media: bool('SEED_MEDIA', true),
    // Фото — 1000 уникальных (требование задачи). Видео — «сколько есть, но все
    // разные»: без API-ключа тысячу уникальных роликов не собрать, поэтому здесь
    // потолок, а фактическое число зависит от доступности источников.
    photos: num('SEED_PHOTOS', 1000),
    videos: num('SEED_VIDEOS', 150),
    // Кэш скачанного (в .gitignore): повторный прогон не тянет файлы из сети заново.
    mediaDir: process.env.SEED_MEDIA_DIR ?? '.seed-media',
    // Заново обойти Викисклад в поисках видео (иначе берётся кэш индекса).
    mediaRefresh: bool('SEED_MEDIA_REFRESH', false),
    allowRemote: bool('SEED_ALLOW_REMOTE', false),
    databaseUrl: process.env.DATABASE_URL ?? '',
  }

  if (config.studentsMin > config.studentsMax) {
    throw new Error('SEED_STUDENTS_MIN больше SEED_STUDENTS_MAX')
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

export { PROFILES, isLocalDatabase }
