// Шаг «личная галерея»: каждому пользователю — свои фото и видео в альбомах профиля.
//
// ПОЧЕМУ КОПИИ, А НЕ ССЫЛКИ НА ОБЩИЙ ПУЛ. Схема: `File @@unique([bucket, key])`
// (prisma/schema/08-files.prisma) — одна строка File равна одному объекту в MinIO.
// Поэтому «сто фотографий у каждого» нельзя сделать сотней ссылок на одни и те же
// двести файлов пула: это сто тысяч строк File, и каждой нужен свой ключ объекта.
// Копии делает сам MinIO (copyObject), байты по сети не гоняются — но место занимают.
// Отсюда и порядок величин: 100 фото × 1481 пользователь ≈ 148 тыс. объектов ≈ 13 ГБ,
// а видео тяжелее фото примерно в 38 раз, поэтому их на пользователя три, а не сто.
//
// Шаг ГЛОБАЛЬНЫЙ, а не внутривузовский: галерея нужна и платформенным ролям, которых
// генератор вузов не видит («каждый пользователь» — это в том числе админ платформы).
// Поэтому он идёт после вузов и обходит таблицу пользователей курсором.
//
// Идемпотентность: ключи объектов и id строк детерминированы (`<userId>-gph-<i>`), копия
// пропускается, если объект уже на месте, а File/Album пишутся с skipDuplicates.

import { child } from '../lib/ids.mjs'
import { runPool } from '../lib/pool.mjs'

// Пользователей за раз в память. Больше смысла не имеет: на каждого приходится сотня
// копий в MinIO, и узкое место — они, а не выборка.
const USER_CHUNK = 200

// Расширение по mime — ключ объекта должен оканчиваться правильно, иначе браузер
// получит файл, тип которого не совпадает с Content-Type.
const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
}

/**
 * Раздаёт каждому пользователю личную галерею.
 *
 * @param pool  пул медиа из шага 10: { photos: [...], videos: [...] } с bucket/key/mime/size
 * @param storage клиент MinIO из lib/storage.mjs (copyIfAbsent)
 */
export async function seedUserMedia(prisma, writer, { config, pool, storage }) {
  const photosPer = config.photosPerUser
  const videosPer = config.videosPerUser
  if (photosPer + videosPer === 0) return { users: 0, files: 0, albums: 0 }

  const photos = pool?.photos ?? []
  const videos = pool?.videos ?? []
  if (photos.length === 0 && videos.length === 0) {
    console.log('  личная галерея: пул медиа пуст — шаг пропущен')
    return { users: 0, files: 0, albums: 0 }
  }
  if (!storage) {
    console.log('  личная галерея: MinIO недоступен — шаг пропущен')
    return { users: 0, files: 0, albums: 0 }
  }

  const bucket = storage.buckets.profileMedia
  const counts = { users: 0, files: 0, albums: 0 }
  let cursor = null

  for (;;) {
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: USER_CHUNK,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (users.length === 0) break
    cursor = users[users.length - 1].id

    // Копии в MinIO — параллельно: один copyObject это round-trip к серверу, и
    // последовательный обход 150 тысяч объектов упёрся бы в задержку сети, а не в диск.
    // А вот запись в БД идёт ПОСЛЕ, одним потоком: буферы writer'а не рассчитаны на
    // параллельное наполнение — два воркера, одновременно переполнившие буфер, ушли бы
    // во встречные createMany одной и той же модели.
    const perUser = []
    await runPool(users, config.mediaConcurrency, async (user) => {
      const rows = []
      const albumPhotoId = child(user.id, 'galph')
      const albumVideoId = child(user.id, 'galvd')

      // Смещение по пулу своё у каждого пользователя: иначе у всех первые сто фото
      // совпали бы, и лента профилей выглядела бы одинаково.
      const offset = hashOffset(user.id)

      for (let i = 0; i < photosPer && photos.length > 0; i += 1) {
        const src = photos[(offset + i) % photos.length]
        const key = `gallery/${user.id}/p${String(i).padStart(3, '0')}.${EXT[src.mime] ?? 'jpg'}`
        await storage.copyIfAbsent(bucket, key, src.bucket, src.key)
        rows.push({
          id: child(user.id, 'gph', i),
          bucket,
          key,
          mime: src.mime,
          size: src.size,
          name: `photo-${i + 1}.${EXT[src.mime] ?? 'jpg'}`,
          ownerId: user.id,
          albumId: albumPhotoId,
        })
      }

      for (let i = 0; i < videosPer && videos.length > 0; i += 1) {
        const src = videos[(offset + i) % videos.length]
        const key = `gallery/${user.id}/v${String(i).padStart(3, '0')}.${EXT[src.mime] ?? 'mp4'}`
        await storage.copyIfAbsent(bucket, key, src.bucket, src.key)
        rows.push({
          id: child(user.id, 'gvd', i),
          bucket,
          key,
          mime: src.mime,
          size: src.size,
          name: `video-${i + 1}.${EXT[src.mime] ?? 'mp4'}`,
          ownerId: user.id,
          albumId: albumVideoId,
          // Постер у видео общий с пулом: отдельный объект-обложку копировать незачем,
          // он лежит в публичном бакете обложек и читается по тому же ключу.
          ...(src.posterKey ? { posterKey: src.posterKey } : {}),
        })
      }

      const albums = []
      if (photosPer > 0 && photos.length > 0) {
        albums.push({ id: albumPhotoId, userId: user.id, title: 'Фотографии' })
      }
      if (videosPer > 0 && videos.length > 0) {
        albums.push({ id: albumVideoId, userId: user.id, title: 'Видео' })
      }
      perUser.push({ albums, rows })
    })

    // Альбомы — первыми: File.albumId ссылается на Album, а writer сбрасывает буферы
    // в порядке первого обращения к модели (lib/writer.mjs, flushUpTo), поэтому album
    // обязан быть затронут раньше file.
    for (const { albums } of perUser) {
      for (const album of albums) await writer.add('album', album)
      counts.albums += albums.length
    }
    for (const { rows } of perUser) {
      for (const row of rows) await writer.add('file', row)
      counts.files += rows.length
      counts.users += 1
    }

    await writer.flush()
    process.stdout.write(`\r  личная галерея: ${counts.users} польз., ${counts.files} файлов`)
  }

  process.stdout.write('\n')
  return counts
}

// Стабильное смещение по пулу от id пользователя (FNV-1a). Нужна только равномерность,
// не криптостойкость.
function hashOffset(value) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}
