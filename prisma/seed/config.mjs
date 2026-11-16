// Конфигурация сида: два параметра объёма, точечные переключатели и гарды.
//
// Объём задаётся ТОЛЬКО числом вузов и студентов на вуз:
//
//   SEED_UNIVERSITIES=4 SEED_STUDENTS=500-1000 pnpm db:seed
//
// Всё остальное выводится из них: факультеты, группы и преподаватели — от числа студентов
// (20-structure.mjs), контент каждого человека — от его роли и уровня активности
// (lib/activity.mjs). Без SEED_UNIVERSITIES заливается только демо-вуз «Алатау» — быстро,
// без сети и MinIO: так `pnpm db:seed` остаётся безопасной командой для сброса стенда.
//
// Профилей масштаба (SEED_SCALE=demo|small|full|kz, отдельный стенд db:seed:test) больше
// нет — решение пользователя от 16.11.2026: один сид, данные относительно вуза и людей.
//
// Все значения читаются один раз на старте и дальше передаются шагам как объект —
// шаги не лезут в process.env сами (иначе конфиг сида не воспроизвести по логу).

// Этапы, которые можно выбрать через SEED_ONLY.
const STAGE_LIST = ['kato', 'media', 'companies', 'universities', 'demo']

// Студентов на вуз по умолчанию — средний вуз. Меньше 400 не бывает: 4 факультета ×
// 4 курса × группа в 25 человек.
const DEFAULT_STUDENTS = [500, 1000]

// Переменные, которые сид больше не читает. Молча игнорировать их нельзя: человек,
// запустивший `SEED_SCALE=full`, ждёт сто вузов и получил бы один демо-вуз.
const REMOVED_ENV = {
  SEED_SCALE: 'профилей нет: задайте SEED_UNIVERSITIES и SEED_STUDENTS',
  SEED_POSTS: 'посты считаются по роли и активности (lib/activity.mjs)',
  SEED_ARTICLES: 'статьи считаются по роли и активности (lib/activity.mjs)',
  SEED_POLLS: 'опросы считаются по роли и активности (lib/activity.mjs)',
  SEED_POLL_VOTES_MAX: 'голоса — доля группы автора (POLL_TURNOUT в lib/activity.mjs)',
  SEED_POST_IMAGES_PER_USER: 'доля постов с медиа задана нормой роли (lib/activity.mjs)',
  SEED_PHOTOS_PER_USER: 'галерея считается по роли и активности; выключить — SEED_MEDIA=0',
  SEED_VIDEOS_PER_USER: 'галерея считается по роли и активности; выключить — SEED_MEDIA=0',
  SEED_FACULTIES: 'факультеты выводятся из числа студентов',
  SEED_TEACHERS: 'преподаватели выводятся из нагрузки групп',
  SEED_GROUP_SIZE: 'размер группы фиксирован — 25 человек',
  SEED_SIZE_BY_KIND: 'размер вуза задаёт SEED_STUDENTS',
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

// Диапазон «A-B» одной строкой (так его задаёт workflow SEED) либо парой MIN/MAX.
// Одно число — вырожденный диапазон. «0-0» — валидное значение и означает «ни одной
// записи»: шаг, которому такой диапазон достался, не создаёт ничего вовсе.
function range(name, fallback) {
  let [min, max] = fallback
  const raw = process.env[`SEED_${name}`]
  if (raw !== undefined && raw !== '') {
    const text = raw.trim()
    const pair = /^(\d+)\s*-\s*(\d+)$/.exec(text)
    if (pair) {
      min = Number(pair[1])
      max = Number(pair[2])
    } else if (/^\d+$/.test(text)) {
      min = Number(text)
      max = min
    } else {
      throw new Error(`SEED_${name}: ожидалось «A-B» или число, получено "${raw}"`)
    }
  }
  // Пара MIN/MAX сильнее строки: ею пользуются старые вызовы и ручная отладка.
  min = num(`SEED_${name}_MIN`, min)
  max = num(`SEED_${name}_MAX`, max)
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new Error(`SEED_${name}: границы диапазона должны быть целыми`)
  }
  if (min < 0) throw new Error(`SEED_${name}: отрицательная нижняя граница`)
  if (min > max) throw new Error(`SEED_${name}: минимум ${min} больше максимума ${max}`)
  return [min, max]
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
  const removed = Object.keys(REMOVED_ENV).filter((name) => process.env[name])
  if (removed.length > 0) {
    throw new Error(
      'Эти переменные сид больше не читает:\n' +
        removed.map((name) => `  ${name} — ${REMOVED_ENV[name]}`).join('\n'),
    )
  }

  const universities = num('SEED_UNIVERSITIES', 0)
  const studentsRange = range('STUDENTS', DEFAULT_STUDENTS)
  const config = {
    universities,
    // Заливать ли демо-вуз «Алатау» с named-аккаунтами (dean@studenthub.app и прочими).
    // На общей базе его выключают: это сотни аккаунтов под одним известным паролем.
    demoUniversity: bool('SEED_DEMO_UNIVERSITY', true),
    // Модераторов платформы. Их создаёт основной сид, а не генератор вузов.
    platformModerators: num('SEED_PLATFORM_MODERATORS', 1),
    studentsMin: studentsRange[0],
    studentsMax: studentsRange[1],
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
    // Медиа (пул фото и видео, образцы форматов, галерея, вложения) — когда есть вузы:
    // `pnpm db:seed` без вузов не должен тянуть из сети полгигабайта и требовать MinIO.
    // Включить для одного демо-вуза — SEED_MEDIA=1, выключить где угодно — SEED_MEDIA=0.
    media: bool('SEED_MEDIA', universities > 0),
    // Пул: 1000 уникальных фото. Видео — «сколько есть, но все разные»: без API-ключа
    // тысячу уникальных роликов не собрать, поэтому здесь потолок, а фактическое число
    // зависит от доступности источников.
    photos: num('SEED_PHOTOS', 1000),
    videos: num('SEED_VIDEOS', 150),
    // Параллельных копий в MinIO. Выше, чем SEED_CONCURRENCY у вузов: copyObject — это
    // ожидание ответа хранилища, а не нагрузка на пул соединений Prisma.
    mediaConcurrency: num('SEED_MEDIA_CONCURRENCY', 16),
    // Кэш скачанного (в .gitignore): повторный прогон не тянет файлы из сети заново.
    mediaDir: process.env.SEED_MEDIA_DIR ?? '.seed-media',
    // Заново обойти Викисклад в поисках видео (иначе берётся кэш индекса).
    mediaRefresh: bool('SEED_MEDIA_REFRESH', false),
    allowRemote: bool('SEED_ALLOW_REMOTE', false),
    // ── Метка прогона и потолки объёма ────────────────────────────────────────
    // Метка попадает в маркеры вузов (lib/marker.mjs) и служит ключом для удаления:
    // `SEED_MODE=cleanup SEED_TAG=<метка>` сносит ровно то, что налил прогон с этой
    // меткой. Пустая метка — прогон без возможности прицельной уборки.
    tag: (process.env.SEED_TAG ?? '').trim(),
    mode: (process.env.SEED_MODE ?? 'seed').trim(),
    // Оценка строк выше мягкого потолка требует SEED_CONFIRM_BIG=1, выше жёсткого —
    // прогон отказывается работать. Наливаем в ту же базу, что у прода: цена ошибки
    // здесь не «долгий прогон», а раздутая боевая база.
    maxRowsSoft: num('SEED_MAX_ROWS_SOFT', 50_000_000),
    maxRowsHard: num('SEED_MAX_ROWS_HARD', 300_000_000),
    confirmBig: bool('SEED_CONFIRM_BIG', false),
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
  if (!Number.isInteger(config.universities) || config.universities < 0) {
    throw new Error('SEED_UNIVERSITIES: ожидалось целое число от 0')
  }
  if (!['seed', 'cleanup'].includes(config.mode)) {
    throw new Error(`SEED_MODE="${config.mode}" неизвестен. Доступно: seed, cleanup`)
  }
  if (config.mode === 'cleanup' && config.tag === '') {
    throw new Error('SEED_MODE=cleanup требует SEED_TAG: без метки нечего удалять')
  }
  if (config.platformModerators < 0) throw new Error('SEED_PLATFORM_MODERATORS отрицательный')
  if (config.maxRowsHard < config.maxRowsSoft) {
    throw new Error('SEED_MAX_ROWS_HARD меньше SEED_MAX_ROWS_SOFT')
  }
  if (
    config.universities > 0 &&
    (config.from < 1 || config.to > config.universities || config.from > config.to)
  ) {
    throw new Error(
      `Диапазон SEED_FROM=${config.from}..SEED_TO=${config.to} вне 1..${config.universities}`,
    )
  }
  if (universities > 0 && !config.allowRemote && !isLocalDatabase(config.databaseUrl)) {
    throw new Error(
      `${universities} вуз(ов) на нелокальной БД заблокировано: это миллионы строк и десятки минут.\n` +
        'Если это действительно нужно — SEED_ALLOW_REMOTE=1.',
    )
  }

  return config
}

export { DEFAULT_STUDENTS, REMOVED_ENV, STAGE_LIST, isLocalDatabase }
