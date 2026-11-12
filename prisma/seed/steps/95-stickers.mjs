// Шаг «стикеры»: собственный набор StudentHub (картинки — prisma/seed/stickers/, их рисует
// generate.mjs) заливается в бакет чатов и заводится опубликованным набором `studenthub`.
//
// Идемпотентно: набор ищется по slug, стикер — по ключу объекта (имя файла устойчивое).
// Повторный прогон докладывает только недостающие стикеры и правит эмодзи и порядок у
// существующих. Флаг публикации и название уже заведённого набора не трогаются: их мог
// поменять администратор в админке, и сид не должен перетирать его решение.
//
// У каждого объекта — запись File (иначе ночная чистка снесёт объект), владелец — первый
// PLATFORM_ADMIN, как у медиа-пула сида.

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const STICKER_SET_SLUG = 'studenthub'
export const STICKER_SET_TITLE = 'StudentHub'
const STICKERS_DIR = fileURLToPath(new URL('../stickers/', import.meta.url))
const KEY_PREFIX = 'seed/stickers/studenthub'

/** Манифест набора: файл, эмодзи, порядок, размеры. */
export function loadStickerManifest() {
  return JSON.parse(readFileSync(`${STICKERS_DIR}stickers.json`, 'utf8'))
}

/**
 * @returns {Promise<{ skipped: boolean, reason?: string, setId?: string, created?: number, total?: number }>}
 */
export async function seedStickers(prisma, storage) {
  if (!(await storage.isAvailable())) {
    return { skipped: true, reason: 'MinIO недоступен' }
  }
  const owner = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!owner) return { skipped: true, reason: 'нет PLATFORM_ADMIN — сначала pnpm db:seed' }

  await storage.ensureBuckets()
  const bucket = storage.buckets.chat
  const set = await prisma.stickerSet.upsert({
    where: { slug: STICKER_SET_SLUG },
    update: {},
    create: {
      slug: STICKER_SET_SLUG,
      title: STICKER_SET_TITLE,
      isPublished: true,
      order: 0,
      createdById: owner.id,
    },
    select: { id: true },
  })

  const manifest = loadStickerManifest()
  let created = 0
  for (const item of manifest) {
    const key = `${KEY_PREFIX}/${item.file}`
    const path = `${STICKERS_DIR}${item.file}`
    const size = statSync(path).size
    await storage.putIfAbsent(bucket, key, path, size, 'image/png')
    const existing = await prisma.sticker.findFirst({
      where: { setId: set.id, file: { bucket, key } },
      select: { id: true },
    })
    if (existing) {
      await prisma.sticker.update({
        where: { id: existing.id },
        data: { emoji: item.emoji, order: item.order },
      })
      continue
    }
    await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          bucket,
          key,
          mime: 'image/png',
          size,
          name: item.file,
          ownerId: owner.id,
          width: item.width,
          height: item.height,
        },
        select: { id: true },
      })
      await tx.sticker.create({
        data: {
          setId: set.id,
          fileId: file.id,
          emoji: item.emoji,
          order: item.order,
          width: item.width,
          height: item.height,
        },
      })
    })
    created += 1
  }
  return { skipped: false, setId: set.id, created, total: manifest.length }
}
