// Шаг «медиа»: скачать фото и видео, положить в MinIO, создать File-строки и раздать
// аватары и обложки всем пользователям.
//
// Почему шаг общий, а не по вузу: объект в бакете уникален по (bucket, key), значит одна
// File-строка = один объект. Аватар при этом — просто URL в поле пользователя, и один
// объект может быть аватаром хоть у тысячи человек. Поэтому фото качаются один раз в
// общий пул, а вузы им пользуются.
//
// Требование задачи — 1000 фото. Видео берём «сколько есть, но все разные» (решение
// пользователя): без API-ключа тысячу уникальных роликов не достать, а размножать один
// файл под тысячей ключей — это тысяча копий в хранилище и ноль пользы.
//
// Лицензии: picsum (производное Unsplash), randomuser.me, образцы Blender Foundation
// (CC-BY) и Викисклад (CC). Источник каждого файла пишется в манифест кэша.

import { Prisma } from '@prisma/client'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createCache, downloadAll, mimeByExt } from '../lib/download.mjs'
import { createStorage } from '../lib/storage.mjs'

// sharp есть в зависимостях apps/api — резолвим оттуда, как и minio.
const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url))

const SOURCES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../data/media-sources.json', import.meta.url)), 'utf8'),
)
const USER_AGENT = 'studenthub-seed/1.0 (dev seed)'

const EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
}

const extByMime = (mime) => EXT_BY_MIME[mime] ?? null

// Расширение из пути URL, без query и фрагмента.
function pathExt(url) {
  try {
    const { pathname } = new URL(url)
    const dot = pathname.lastIndexOf('.')
    return dot === -1 ? null : pathname.slice(dot)
  } catch {
    return null
  }
}

// Файлы пула принадлежат платформенному администратору: это стоковый контент сида,
// а не загрузка конкретного студента. Владелец обязателен (File.ownerId → User).
async function poolOwnerId(prisma) {
  const admin = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) throw new Error('Нет PLATFORM_ADMIN — сначала должен пройти основной сид')
  return admin.id
}

// ── План скачивания ──────────────────────────────────────────────────────────
function planPhotos(count) {
  const { faces, content } = SOURCES.photos
  const items = []
  // Портреты: ровно по половине на каждый пол, они идут в аватары.
  const faceCount = Math.min(faces.genders.length * faces.perGender, Math.round(count * 0.2))
  for (let i = 0; i < faceCount; i += 1) {
    const gender = faces.genders[i % faces.genders.length]
    const n = Math.floor(i / faces.genders.length) % faces.perGender
    items.push({
      kind: 'face',
      name: `photos/face-${gender}-${String(n).padStart(3, '0')}.jpg`,
      url: faces.template.replace('{gender}', gender).replace('{n}', String(n)),
      license: 'randomuser.me (free for demo use)',
    })
  }
  // Контентные фото: разные пропорции — портретные, квадратные, ландшафтные.
  for (let i = 0; i < count - faceCount; i += 1) {
    const [w, h] = content.sizes[i % content.sizes.length]
    items.push({
      kind: 'photo',
      name: `photos/content-${String(i).padStart(4, '0')}.jpg`,
      url: content.template
        .replace('{n}', String(i))
        .replace('{w}', String(w))
        .replace('{h}', String(h)),
      license: 'picsum.photos (Unsplash derivative)',
    })
  }
  return items
}

// Викисклад: обходим тематические категории, берём только видео до maxBytes.
// Пагинация нужна: в категории тысячи файлов, но мелких среди них меньшинство.
//
// Вежливость к API обязательна: Викимедиа отвечает 429 «You are making too many
// requests» уже на десятках подряд идущих запросов, и первая версия этого обхода
// молча обрывалась на полпути. Поэтому пауза между запросами, повтор на 429 и явное
// сообщение в лог, если обход всё-таки прервался.
const COMMONS_DELAY_MS = 400
const COMMONS_RETRIES = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function commonsRequest(url) {
  for (let attempt = 1; attempt <= COMMONS_RETRIES; attempt += 1) {
    await sleep(COMMONS_DELAY_MS)
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (response.status === 429) {
        await sleep(2000 * attempt)
        continue
      }
      if (!response.ok) return { error: `HTTP ${response.status}` }
      return { data: await response.json() }
    } catch (error) {
      if (attempt === COMMONS_RETRIES) return { error: error.message }
    }
  }
  return { error: 'слишком много запросов (429)' }
}

async function planCommonsVideos(limit, cache, refresh) {
  // Индекс найденных видео кэшируется: список URL меняется редко, а каждый обход —
  // это сотня запросов к чужому API. SEED_MEDIA_REFRESH=1 заставляет обойти заново.
  const indexPath = join(cache.dir, 'commons-index.json')
  const cached = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : null
  const known = Array.isArray(cached?.items) ? cached.items : []
  if (!refresh && known.length > 0) {
    return { items: known.slice(0, limit), fromIndex: true, interrupted: false }
  }

  const { api, categories, maxBytes } = SOURCES.videos.commons
  // Обход ДОПОЛНЯЕТ индекс, а не заменяет: лимит запросов обрывает обход в случайном
  // месте, и запись «что нашли на этот раз» могла бы уменьшить уже собранный список.
  // Имена файлов у известных записей сохраняются — иначе кэш скачанного обнулится.
  const items = [...known]
  const seen = new Set(items.map((i) => i.title ?? i.url))
  // Курсор пагинации на категорию. Без него повторный обход начинался бы с первой
  // категории, снова выбирал бы уже известные файлы и тратил лимит запросов впустую —
  // именно так второй SEED_MEDIA_REFRESH не добавлял ни одного видео.
  const cursors = cached?.cursors ?? {}
  let interrupted = false

  for (const category of categories) {
    if (items.length >= limit) break
    if (cursors[category] === 'done') continue
    let cont = cursors[category] ?? null
    // До пяти страниц по 100 файлов на категорию: дальше отдача мелких файлов падает,
    // а время обхода растёт.
    for (let page = 0; page < 5 && items.length < limit; page += 1) {
      const url = new URL(api)
      url.search = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'categorymembers',
        gcmtitle: category,
        gcmtype: 'file',
        gcmlimit: '100',
        prop: 'imageinfo',
        iiprop: 'url|mime|size|extmetadata',
        iiurlwidth: '640',
        ...(cont ? { gcmcontinue: cont } : {}),
      }).toString()

      const { data, error } = await commonsRequest(url)
      if (error) {
        interrupted = true
        break
      }

      for (const item of Object.values(data?.query?.pages ?? {})) {
        const info = item.imageinfo?.[0]
        if (!info?.mime?.startsWith('video/') || info.size > maxBytes) continue
        const title = item.title.replace(/^File:/, '')
        if (seen.has(title) || items.length >= limit) continue
        seen.add(title)
        // Имя в кэше — свой безопасный слаг: в заголовках Викисклада бывает всё.
        // Расширение берём из ПУТИ url, а не из строки целиком: у ссылок Викисклада
        // есть query (?utm_source=…), и «всё после последней точки» превращалось в
        // ключ вида `commons-000.org&utm_campaign=…`.
        const ext = extByMime(info.mime) ?? pathExt(info.url) ?? '.webm'
        items.push({
          kind: 'video',
          name: `videos/commons-${String(items.length).padStart(3, '0')}${ext}`,
          // (индекс в имени = позиция в накопленном списке, поэтому дополнение не
          //  переименовывает уже скачанные файлы)
          url: info.url,
          // Постер отдаёт сам API (кадр видео) — без ffmpeg его иначе не получить.
          posterUrl: info.thumburl ?? null,
          title,
          license: info.extmetadata?.LicenseShortName?.value ?? 'CC (Wikimedia Commons)',
        })
      }

      cont = data?.continue?.gcmcontinue ?? null
      cursors[category] = cont ?? 'done'
      if (!cont) break
    }
    if (interrupted) break
  }

  if (items.length > 0) {
    const index = { savedAt: new Date().toISOString(), cursors, items }
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  }
  return { items, fromIndex: false, interrupted }
}

function planSampleVideos() {
  const { base, files } = SOURCES.videos.samples
  return files.map((path, i) => ({
    kind: 'video',
    name: `videos/sample-${String(i).padStart(3, '0')}.mp4`,
    url: `${base}${path}`,
    posterUrl: null,
    title: path.split('/').pop(),
    license: 'Blender Foundation, CC-BY (test-videos.co.uk)',
  }))
}

export async function seedMedia(prisma, config) {
  const storage = createStorage()
  if (!(await storage.isAvailable())) {
    console.log('  MinIO недоступен — шаг медиа пропущен (аватары и вложения останутся пустыми).')
    return null
  }
  await storage.ensureBuckets()
  const ownerId = await poolOwnerId(prisma)
  const cache = createCache(config.mediaDir)

  // ── 1. План и скачивание ──────────────────────────────────────────────────
  const photoPlan = planPhotos(config.photos)
  const samplePlan = planSampleVideos()
  const commons =
    config.videos > samplePlan.length
      ? await planCommonsVideos(config.videos - samplePlan.length, cache, config.mediaRefresh)
      : { items: [], fromIndex: false, interrupted: false }
  const videoPlan = [...samplePlan, ...commons.items].slice(0, config.videos)

  console.log(
    `Медиа: ${photoPlan.length} фото + ${videoPlan.length} видео ` +
      `(${samplePlan.length} образцов + ${commons.items.length} с Викисклада` +
      `${commons.fromIndex ? ', индекс из кэша' : ''}), кэш ${cache.dir}`,
  )
  if (commons.interrupted) {
    // Молчать нельзя: пул оказался меньше запрошенного не потому, что видео закончились.
    console.log(
      `  обход Викисклада прерван (лимит запросов) — уникальных видео ${videoPlan.length} ` +
        `вместо ${config.videos}; повторить обход: SEED_MEDIA_REFRESH=1`,
    )
  }

  const report = { downloaded: 0, cached: 0, uploaded: 0, failed: 0 }
  // Счётчик на партию: общий на все партии сбивал бы «из кэша» больше, чем всего файлов.
  const progressFor = (label, logEvery) => {
    let cached = 0
    return (processed, total, _name, fromCache) => {
      if (fromCache) {
        cached += 1
        report.cached += 1
      } else {
        report.downloaded += 1
      }
      if (processed % logEvery === 0 || processed === total) {
        console.log(`  ${label}: ${processed}/${total} (из кэша ${cached})`)
      }
    }
  }

  const photos = await downloadAll(cache, photoPlan, {
    concurrency: 8,
    onProgress: progressFor('фото', 100),
  })
  const videos = await downloadAll(cache, videoPlan, {
    concurrency: 4,
    onProgress: progressFor('видео', 10),
  })
  report.failed = photos.failed.length + videos.failed.length
  if (report.failed > 0) {
    console.log(`  не скачалось ${report.failed} файлов (источник недоступен) — пул меньше плана`)
  }

  // Постеры видео качаем отдельным проходом: без них плеер показывает чёрный кадр.
  const posterPlan = videos.done
    .filter((v) => v.posterUrl)
    .map((v) => ({
      kind: 'poster',
      name: `posters/${v.name
        .split('/')
        .pop()
        .replace(/\.[^.]+$/, '')}.jpg`,
      url: v.posterUrl,
      license: v.license,
    }))
  const posters = posterPlan.length > 0 ? await downloadAll(cache, posterPlan, {}) : { done: [] }
  const posterByName = new Map(posters.done.map((p) => [p.name.split('/').pop(), p]))

  // ── 2. Выгрузка в MinIO + File-строки ─────────────────────────────────────
  // Раскладка по бакетам: портреты — в avatars (публичный, отдаётся по прямому URL),
  // остальное — в profile-media (тоже публичный: галерея профиля и обложки).
  const { buckets } = storage
  const pool = { faces: [], photos: [], videos: [] }

  const upload = async (item, bucket, key, extra = {}) => {
    const mime =
      item.mime?.startsWith('image/') || item.mime?.startsWith('video/')
        ? item.mime
        : mimeByExt(item.name)
    const created = await storage.putIfAbsent(bucket, key, item.path, item.size, mime)
    if (created) report.uploaded += 1
    const fileId = `seed-media-${key.replace(/[^a-zA-Z0-9]/g, '-')}`
    const data = {
      bucket,
      key,
      mime,
      size: item.size,
      name: item.title ?? item.name.split('/').pop(),
      ownerId,
      ...extra,
    }
    // upsert, а не createMany: File нужен сразу с id для ссылок из пула.
    await prisma.file.upsert({
      where: { id: fileId },
      update: data,
      create: { id: fileId, ...data },
    })
    return { fileId, key, bucket, url: storage.publicUrl(bucket, key), mime, size: item.size }
  }

  for (const item of photos.done) {
    const isFace = item.kind === 'face'
    const bucket = isFace ? buckets.avatars : buckets.profileMedia
    const key = `seed/${item.name.split('/').pop()}`
    const entry = await upload(item, bucket, key)
    ;(isFace ? pool.faces : pool.photos).push(entry)
  }

  for (const item of videos.done) {
    const key = `seed/${item.name.split('/').pop()}`
    const poster = posterByName.get(`${key.replace(/\.[^.]+$/, '')}.jpg`.split('/').pop())
    let posterKey = null
    if (poster) {
      posterKey = `seed/posters/${poster.name.split('/').pop()}`
      await storage.putIfAbsent(buckets.profileCovers, posterKey, poster.path, poster.size, 'image/jpeg') // prettier-ignore
      const posterFileId = `seed-media-${posterKey.replace(/[^a-zA-Z0-9]/g, '-')}`
      const posterData = {
        bucket: buckets.profileCovers,
        key: posterKey,
        mime: 'image/jpeg',
        size: poster.size,
        name: poster.name.split('/').pop(),
        ownerId,
      }
      await prisma.file.upsert({
        where: { id: posterFileId },
        update: posterData,
        create: { id: posterFileId, ...posterData },
      })
    }
    pool.videos.push(await upload(item, buckets.profileMedia, key, { posterKey }))
  }

  // ── 3. Источники для изображений постов ───────────────────────────────────
  // Постов теперь десятки на пользователя, и картинка нужна многим. Скачивать что-то
  // ещё незачем: берём уже загруженные фото, уменьшаем до ширины поста (640px, ~23 КБ
  // против 74 КБ) и кладём в бакет постов как ИСТОЧНИКИ. Дальше шаг соцчасти делает из
  // них серверные копии — по одной на пост, потому что File.postId эксклюзивен, а
  // объект уникален по (bucket, key). Копия делается внутри MinIO: байты по сети не идут.
  const imageSources = []
  if (config.postImagesPerUser > 0 && photos.done.length > 0) {
    const sharp = requireFromApi('sharp')
    const smallDir = join(cache.dir, 'small')
    mkdirSync(smallDir, { recursive: true })
    const sourcePhotos = photos.done.filter((p) => p.kind === 'photo')
    const rows = []
    for (const [i, item] of sourcePhotos.entries()) {
      const name = `src-${String(i).padStart(4, '0')}.jpg`
      const smallPath = join(smallDir, name)
      if (!existsSync(smallPath)) {
        await sharp(item.path)
          .resize(640, null, { withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toBuffer()
          .then((buf) => writeFileSync(smallPath, buf))
      }
      const size = statSync(smallPath).size
      const key = `seed/src/${name}`
      await storage.putIfAbsent(buckets.posts, key, smallPath, size, 'image/jpeg')
      // File-строка обязательна: бакет постов входит в ночную уборку сирот
      // (cleanOrphanFiles), и объект без записи File исчез бы. postId у источника нет.
      const fileId = `seed-media-src-${name.replace(/[^a-zA-Z0-9]/g, '-')}`
      rows.push({
        id: fileId,
        bucket: buckets.posts,
        key,
        mime: 'image/jpeg',
        size,
        name,
        ownerId,
      })
      imageSources.push({ bucket: buckets.posts, key, size, mime: 'image/jpeg' })
    }
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.file.createMany({ data: rows.slice(i, i + 500), skipDuplicates: true })
    }
    console.log(
      `  источники для картинок постов: ${imageSources.length} шт. ` +
        `(${Math.round(imageSources.reduce((s2, x) => s2 + x.size, 0) / 1024 / 1024)} МБ)`,
    )
  }
  pool.imageSources = imageSources

  // ── 4. Аватары и обложки всем пользователям ───────────────────────────────
  // Обновляем пачками updateMany по списку id: 125 000 отдельных update — это 125 000
  // round-trip'ов, а так выходит несколько сотен запросов.
  const assigned = await assignAvatars(prisma, pool)

  console.log(
    `Медиа готово: пул ${pool.faces.length} портретов, ${pool.photos.length} фото, ` +
      `${pool.videos.length} видео; выгружено в MinIO ${report.uploaded}, ` +
      `из кэша ${report.cached}, аватары розданы ${assigned} пользователям`,
  )
  return pool
}

// Раздача аватаров и обложек.
//
// Кому раздаём: тем, у кого аватара нет, и тем, у кого стоит аватар из ЭТОГО же пула
// (префикс /avatars/seed/). Загруженный человеком аватар сид не перетирает — это его
// файл; а свою прошлую раздачу переигрывает, иначе пул, выросший со 4 портретов до
// 200, так и остался бы четырьмя лицами на весь вуз.
//
// Как раздаём: один UPDATE ... FROM (VALUES …) на пачку в 500 человек. Через
// updateMany пришлось бы либо ставить один аватар на всю пачку (и тогда в списке
// группы 25 одинаковых лиц), либо делать по запросу на человека — 125 000
// round-trip'ов. Значения идут параметрами (BACKEND_RULES §14.4), как в шаге КАТО.
async function assignAvatars(prisma, pool) {
  if (pool.faces.length === 0) return 0
  const chunkSize = 500
  const seedAvatarPrefix = pool.faces[0].url.slice(0, pool.faces[0].url.lastIndexOf('/') + 1)
  let assigned = 0
  let cursor = null

  for (;;) {
    const users = await prisma.user.findMany({
      where: {
        OR: [{ avatarUrl: null }, { avatarUrl: { startsWith: seedAvatarPrefix } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: chunkSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (users.length === 0) break
    cursor = users[users.length - 1].id

    const values = users.map((user, i) => {
      const face = pool.faces[(assigned + i) % pool.faces.length]
      const cover = pool.photos.length > 0 ? pool.photos[(assigned + i) % pool.photos.length] : face
      // Превью аватара обычно делает джоба generate-thumbnail; отдельного объекта-превью
      // у сида нет, поэтому показываем тот же файл — клиент этого не различает.
      return Prisma.sql`(${user.id}, ${face.url}, ${face.url}, ${cover.url})`
    })
    await prisma.$executeRaw`
      UPDATE "users" SET
        "avatar_url"       = v.avatar,
        "avatar_thumb_url" = v.thumb,
        "cover_url"        = v.cover
      FROM (VALUES ${Prisma.join(values)}) AS v(id, avatar, thumb, cover)
      WHERE "users"."id" = v.id
    `
    assigned += users.length
  }
  return assigned
}

export { assignAvatars }
