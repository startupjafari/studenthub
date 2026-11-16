// Образцы всех форматов, которые принимает платформа (prisma/seed/formats/): каталог,
// раскладка по бакетам и сборка строк File для вложений.
//
// Раскладка детерминирована — ключ объекта `seed/formats/<файл>` в каждом бакете из
// FORMAT_BUCKETS. Поэтому пул образцов вычисляется без обращения к MinIO и к БД: шаги вузов
// получают его и тогда, когда сам шаг заливки (steps/12-formats.mjs) в этом прогоне не шёл
// (SEED_ONLY=universities).
//
// Ссылки, а не копии: пара (bucket, key) у File не уникальна (миграция
// 20260929121630_files_shared_object_pool), и удаление File снимает объект только когда на
// него больше никто не ссылается (FileService). Поэтому «PDF во вложении у каждого второго
// сообщения» стоит строку в БД, а не объект в хранилище.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FORMATS_DIR = fileURLToPath(new URL('../formats/files/', import.meta.url))

/** Каталог образцов: файл, mime, категория (как в FILE_UPLOAD.ALLOWED_MIME), имена, размеры. */
export const FORMAT_CATALOG = JSON.parse(
  readFileSync(fileURLToPath(new URL('../formats/formats.json', import.meta.url)), 'utf8'),
)

/**
 * Бакеты, в которые кладутся образцы (ключи — имена из storage.buckets). Во все — целиком:
 * образцы весят меньше мегабайта, а модуль сам решает, какие категории он принимает.
 */
export const FORMAT_BUCKETS = [
  'chat',
  'materials',
  'documents',
  'applications',
  'posts',
  'stories',
  'storyHighlights',
  'profileMedia',
]

export const formatKey = (file) => `seed/formats/${file}`

/** id базовой строки File образца в бакете — она держит объект от ночной уборки сирот. */
export const formatBaseFileId = (bucketKey, file) =>
  `seed-format-${bucketKey}-${file.replace(/[^a-zA-Z0-9]/g, '-')}`

/**
 * Пул образцов: `{ [bucketKey]: Sample[] }`, где Sample — запись каталога плюс bucket и key.
 * Без хранилища (MinIO недоступен или медиа выключено) — null: шаги обходятся без вложений.
 */
export function formatPool(storage) {
  if (!storage) return null
  const pool = {}
  for (const bucketKey of FORMAT_BUCKETS) {
    const bucket = storage.buckets[bucketKey]
    if (!bucket) continue
    pool[bucketKey] = FORMAT_CATALOG.map((item) => ({
      ...item,
      bucketKey,
      bucket,
      key: formatKey(item.file),
    }))
  }
  return pool
}

/**
 * Образцы бакета с фильтром. `categories` — IMAGE/VIDEO/DOCUMENT/AUDIO/ARCHIVE, `roles` —
 * уточнение внутри категории: voice (голосовое, имя `voice-…`), music, gif. Пусто — всё.
 */
export function formatSamples(pool, bucketKey, { categories, roles, mimes } = {}) {
  const list = pool?.[bucketKey] ?? []
  return list.filter(
    (s) =>
      (!categories || categories.includes(s.category)) &&
      (!roles || roles.includes(s.role)) &&
      (!mimes || mimes.includes(s.mime)),
  )
}

/**
 * Строка File-вложения, ссылающаяся на объект образца. `n` — порядковый номер в шаге: по
 * нему выбирается одно из правдоподобных имён, чтобы в чате не было десяти «Методичка.pdf».
 * Голосовое получает имя `voice-<n>.<ext>`: по префиксу клиенты отличают его от музыки.
 *
 * Остальные поля (ownerId, messageId/materialId/…, createdAt, spoiler, asDocument) — в extra.
 */
export function formatFileRow(sample, n, extra) {
  const ext = sample.file.slice(sample.file.indexOf('.'))
  const name =
    sample.role === 'voice'
      ? `voice-${String(n).padStart(6, '0')}${ext}`
      : sample.names[n % sample.names.length]
  return {
    bucket: sample.bucket,
    key: sample.key,
    mime: sample.mime,
    size: sample.size,
    name,
    ...(sample.width ? { width: sample.width, height: sample.height } : {}),
    ...(sample.durationMs ? { durationMs: sample.durationMs } : {}),
    ...extra,
  }
}

/**
 * Круговой выбор образцов: каждый формат категории попадается по очереди, а не случайно —
 * так на любом объёме данных встречаются ВСЕ форматы, а не «почти все».
 */
export function formatCycler(samples) {
  let i = 0
  return () => {
    if (samples.length === 0) return null
    const sample = samples[i % samples.length]
    i += 1
    return sample
  }
}
