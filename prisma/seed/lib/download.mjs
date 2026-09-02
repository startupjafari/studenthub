// Скачивание медиа в локальный кэш с манифестом.
//
// Кэш (.seed-media/, в .gitignore) нужен, чтобы повторный прогон сида не тянул из сети
// те же полтора гигабайта: файл считается готовым, если он есть на диске и его размер
// совпадает с записанным в манифесте. Манифест хранит и sha256 — по нему видно, что
// источник подменил содержимое по тому же URL.
//
// Ошибки скачивания не роняют сид: недоступный источник — это нормальная ситуация для
// сети, и терять из-за одного 404 весь прогон нельзя. Пропущенные файлы попадают в
// отчёт, а медиа-пул просто оказывается меньше.

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs' // prettier-ignore
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { runPool } from './pool.mjs'

const USER_AGENT = 'studenthub-seed/1.0 (dev seed; +https://github.com/startupjafari/studenthub)'
const RETRIES = 3

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'application/ogg': '.ogv',
}

export function mimeByExt(name) {
  const lower = name.toLowerCase()
  for (const [mime, ext] of Object.entries(EXT_BY_MIME)) {
    if (lower.endsWith(ext)) return mime
  }
  return 'application/octet-stream'
}

export function createCache(dir) {
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, 'manifest.json')
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : { version: 1, files: {} }

  function save() {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  return { dir, manifest, manifestPath, save }
}

async function fetchToFile(url, filePath) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }
  mkdirSync(dirname(filePath), { recursive: true })
  const hash = createHash('sha256')
  const file = createWriteStream(filePath)
  // Хэш считаем на лету: второй проход по файлу на гигабайтах — лишние минуты.
  const source = Readable.fromWeb(response.body)
  source.on('data', (chunk) => hash.update(chunk))
  await pipeline(source, file)
  return {
    size: statSync(filePath).size,
    sha256: hash.digest('hex'),
    mime: (response.headers.get('content-type') ?? '').split(';')[0] || mimeByExt(filePath),
  }
}

/**
 * Скачивает список { name, url } в кэш. Возвращает готовые записи и список ошибок.
 * name — имя файла внутри кэша, оно же ключ манифеста и часть ключа объекта в MinIO.
 */
export async function downloadAll(cache, items, { concurrency = 8, onProgress } = {}) {
  const done = []
  const failed = []
  let processed = 0

  await runPool(items, concurrency, async (item) => {
    const filePath = join(cache.dir, item.name)
    const known = cache.manifest.files[item.name]

    if (known && existsSync(filePath) && statSync(filePath).size === known.size) {
      done.push({ ...item, ...known, path: filePath, cached: true })
      processed += 1
      onProgress?.(processed, items.length, item.name, true)
      return
    }

    let lastError = null
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        const meta = await fetchToFile(item.url, filePath)
        cache.manifest.files[item.name] = { url: item.url, license: item.license ?? null, ...meta }
        done.push({ ...item, ...meta, path: filePath, cached: false })
        lastError = null
        break
      } catch (error) {
        lastError = error
        // Пауза растёт: 0.5с, 1с, 1.5с — на случай троттлинга источника.
        await new Promise((resolve) => setTimeout(resolve, attempt * 500))
      }
    }
    if (lastError) failed.push({ name: item.name, url: item.url, error: lastError.message })

    processed += 1
    onProgress?.(processed, items.length, item.name, false)
  }).catch((error) => {
    // runPool агрегирует ошибки воркеров; здесь их быть не должно (все пойманы выше),
    // но глотать молча нельзя.
    failed.push({ name: '(pool)', url: '', error: error.message })
  })

  cache.save()
  return { done, failed }
}
