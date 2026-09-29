// Шаг «личная галерея»: каждому пользователю — свои фото и видео в альбомах профиля.
//
// ССЫЛКИ НА ОБЩИЙ ПУЛ, А НЕ КОПИИ. Пара (bucket, key) у File больше не уникальна
// (миграция 20260929121630_files_shared_object_pool), поэтому сто карточек галереи —
// это сто строк File, указывающих на одни и те же объекты пула. Копий в MinIO не
// делается вовсе: 100 фото × 130 тыс. пользователей стоили бы ~13 млн объектов и сотни
// гигабайт, а ссылки стоят ровно ноль байт сверх самого пула.
//
// Плата — реализм: картинки у всех одинаковые, и раздачу медиа под нагрузкой таким
// стендом не измерить. Для демо-данных это приемлемо, для нагрузочного теста — нет.
//
// Шаг ГЛОБАЛЬНЫЙ, а не внутривузовский: галерея нужна и платформенным ролям, которых
// генератор вузов не видит («каждый пользователь» — это в том числе админ платформы).
// Поэтому он идёт после вузов и обходит таблицу пользователей курсором.
//
// Идемпотентность: id строк детерминированы (`<userId>-gph-<i>`), File/Album пишутся
// с skipDuplicates.

import { child } from '../lib/ids.mjs'

// Пользователей за раз в память. Строки File собираются пачкой и уходят одним
// createMany — больше держать незачем.
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
 * Раздаёт каждому пользователю личную галерею — ссылками на объекты общего пула.
 *
 * @param pool пул медиа из шага 10: { photos: [...], videos: [...] } с bucket/key/mime/size
 */
export async function seedUserMedia(prisma, writer, { config, pool }) {
  // Диапазоны, а не числа: «100-500 фото» означает своё случайное количество у каждого
  // пользователя. Верхняя граница нулевая у обоих — шага нет вовсе.
  const [photosMin, photosMax] = config.photosPerUser
  const [videosMin, videosMax] = config.videosPerUser
  if (photosMax + videosMax === 0) return { users: 0, files: 0, albums: 0 }

  const photos = pool?.photos ?? []
  const videos = pool?.videos ?? []
  if (photos.length === 0 && videos.length === 0) {
    console.log('  личная галерея: пул медиа пуст — шаг пропущен')
    return { users: 0, files: 0, albums: 0 }
  }
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

    // Строки собираются в памяти, а запись в БД идёт ПОСЛЕ, одним потоком: буферы
    // writer'а не рассчитаны на параллельное наполнение — два воркера, одновременно
    // переполнившие буфер, ушли бы во встречные createMany одной и той же модели.
    const perUser = []
    for (const user of users) {
      const rows = []
      const albumPhotoId = child(user.id, 'galph')
      const albumVideoId = child(user.id, 'galvd')

      // Смещение по пулу своё у каждого пользователя: иначе у всех первые сто фото
      // совпали бы, и лента профилей выглядела бы одинаково. Из того же хэша берётся и
      // количество: детерминированно по id, без общего потока случайных чисел (шаг
      // обходит пользователей параллельно, и общий PRNG сделал бы результат невоспроизводимым).
      const offset = hashOffset(user.id)
      const photosPer = countIn(offset, photosMin, photosMax)
      const videosPer = countIn(Math.imul(offset, 0x9e3779b1) >>> 0, videosMin, videosMax)

      for (let i = 0; i < photosPer && photos.length > 0; i += 1) {
        const src = photos[(offset + i) % photos.length]
        rows.push({
          id: child(user.id, 'gph', i),
          bucket: src.bucket,
          key: src.key,
          mime: src.mime,
          size: src.size,
          name: `photo-${i + 1}.${EXT[src.mime] ?? 'jpg'}`,
          ownerId: user.id,
          albumId: albumPhotoId,
        })
      }

      for (let i = 0; i < videosPer && videos.length > 0; i += 1) {
        const src = videos[(offset + i) % videos.length]
        rows.push({
          id: child(user.id, 'gvd', i),
          bucket: src.bucket,
          key: src.key,
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
    }

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

// Число в диапазоне [min, max] по готовому хэшу. Равномерность здесь важнее качества:
// разброс нужен, чтобы галереи не выглядели одинаковыми.
function countIn(hash, min, max) {
  if (max <= min) return min
  return min + (hash % (max - min + 1))
}
