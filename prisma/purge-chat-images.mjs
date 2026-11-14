// Разовая уборка картинок чатов на тестовой среде Railway (по просьбе владельца 15.11.2026).
//
// Что делает:
//   1. Сообщения с картинкой (фото, GIF, отправленное «без сжатия») и со стикером —
//      удаляются «у всех» так же, как это делает API: deleted_at = now(). Клиенты узнают
//      об удалении догоном (`GET /chats/:id/updates` → deletedIds).
//   2. Превью ссылок — у карточки обнуляется адрес картинки OG, текст карточки остаётся.
//   3. Строки files с картинками чатов (вложения сообщений, незавершённые загрузки в бакете
//      чатов, картинки стикеров) — удаляются; file_variants, stickers и favorite_stickers
//      уходят каскадом.
//   4. Наборы стикеров — удаляются целиком.
//   5. Объекты MinIO удалённых строк (оригинал, постер, варианты) — удаляются, если на тот
//      же ключ не ссылается другая строка. Что не удалось снять — снимет ночной
//      cleanOrphanFiles.
//
//   node prisma/purge-chat-images.mjs   (DATABASE_URL, MINIO_* из окружения)
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PrismaClient } from '@prisma/client'

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url))
const { Client } = requireFromApi('minio')

const CHAT_BUCKET = process.env.MINIO_BUCKET_CHAT || 'chat-media'
const BATCH = 2000
const REMOVE_CHUNK = 1000

const prisma = new PrismaClient()
const minio = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: String(process.env.MINIO_USE_SSL ?? 'false') === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
})

async function hasColumn(table, column) {
  const rows = column
    ? await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
        table,
        column,
      )
    : await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
        table,
      )
  return rows.length > 0
}

const n = (v) => Number(v ?? 0)

async function main() {
  // Хранилище обязано отвечать до первой записи: иначе строки уйдут, а объекты останутся
  // до ночного прохода, и «удалено» в сводке было бы неправдой.
  await minio.listBuckets()

  const has = {
    stickers: await hasColumn('stickers'),
    stickerSets: await hasColumn('sticker_sets'),
    variants: await hasColumn('file_variants'),
    stickerCol: await hasColumn('messages', 'sticker_id'),
    linkPreview: await hasColumn('messages', 'link_preview'),
    posterKey: await hasColumn('files', 'poster_key'),
  }
  console.log('Схема Railway:', has)

  const fileWhere =
    `((f.mime LIKE 'image/%' AND (f.message_id IS NOT NULL OR f.bucket = $1))` +
    (has.stickers ? ` OR f.id IN (SELECT file_id FROM stickers))` : ')')

  const [before] = await prisma.$queryRawUnsafe(
    `SELECT count(*) AS files FROM files f WHERE ${fileWhere}`,
    CHAT_BUCKET,
  )
  console.log(`Строк files к удалению: ${n(before.files)}`)

  // 1. Сообщения с картинкой или стикером — «удалить у всех».
  const messages = await prisma.$executeRawUnsafe(
    `UPDATE messages SET deleted_at = now()
     WHERE deleted_at IS NULL AND (
       id IN (SELECT message_id FROM files WHERE mime LIKE 'image/%' AND message_id IS NOT NULL)
       ${has.stickerCol ? 'OR sticker_id IS NOT NULL' : ''}
     )`,
  )
  console.log(`Сообщений удалено: ${messages}`)

  // 2. Картинки в превью ссылок.
  const previews = has.linkPreview
    ? await prisma.$executeRawUnsafe(
        `UPDATE messages SET link_preview = jsonb_set(link_preview, '{image}', 'null'::jsonb)
         WHERE link_preview IS NOT NULL AND jsonb_typeof(link_preview) = 'object'
           AND link_preview->>'image' IS NOT NULL`,
      )
    : 0
  console.log(`Превью ссылок без картинки: ${previews}`)

  // 3 и 5. Строки files и их объекты — порциями.
  let filesDeleted = 0
  let objectsRemoved = 0
  let objectsFailed = 0
  for (;;) {
    const batch = await prisma.$queryRawUnsafe(
      `SELECT f.id, f.bucket, f.key${has.posterKey ? ', f.poster_key AS "posterKey"' : ''}
       FROM files f WHERE ${fileWhere} LIMIT ${BATCH}`,
      CHAT_BUCKET,
    )
    if (batch.length === 0) break
    const ids = batch.map((f) => f.id)
    const variants = has.variants
      ? await prisma.$queryRawUnsafe(
          `SELECT file_id AS "fileId", key FROM file_variants WHERE file_id = ANY($1::text[])`,
          ids,
        )
      : []

    // Кандидаты на снятие из хранилища, по бакетам.
    const byBucket = new Map()
    const add = (bucket, key) => {
      if (!key) return
      if (!byBucket.has(bucket)) byBucket.set(bucket, new Set())
      byBucket.get(bucket).add(key)
    }
    const bucketOf = new Map(batch.map((f) => [f.id, f.bucket]))
    for (const f of batch) {
      add(f.bucket, f.key)
      add(f.bucket, f.posterKey)
    }
    for (const v of variants) add(bucketOf.get(v.fileId), v.key)

    filesDeleted += await prisma.$executeRawUnsafe(
      `DELETE FROM files WHERE id = ANY($1::text[])`,
      ids,
    )

    for (const [bucket, keySet] of byBucket) {
      const keys = [...keySet]
      // На один ключ могут ссылаться несколько строк (пересылка) — живые не трогаем.
      const alive = await prisma.$queryRawUnsafe(
        `SELECT key FROM files WHERE bucket = $1 AND key = ANY($2::text[])
         ${has.posterKey ? 'UNION SELECT poster_key FROM files WHERE bucket = $1 AND poster_key = ANY($2::text[])' : ''}
         ${has.variants ? 'UNION SELECT v.key FROM file_variants v JOIN files f ON f.id = v.file_id WHERE f.bucket = $1 AND v.key = ANY($2::text[])' : ''}`,
        bucket,
        keys,
      )
      const aliveSet = new Set(alive.map((r) => r.key))
      const toRemove = keys.filter((k) => !aliveSet.has(k))
      for (let i = 0; i < toRemove.length; i += REMOVE_CHUNK) {
        const chunk = toRemove.slice(i, i + REMOVE_CHUNK)
        try {
          const errors = (await minio.removeObjects(bucket, chunk)) ?? []
          const failed = errors.filter((e) => e && (e.Code || e.code || e.Error)).length
          objectsFailed += failed
          objectsRemoved += chunk.length - failed
        } catch (err) {
          objectsFailed += chunk.length
          console.warn(`MinIO ${bucket}: ${err.message}`)
        }
      }
    }
    console.log(`… строк files удалено: ${filesDeleted}, объектов снято: ${objectsRemoved}`)
  }

  // 4. Наборы стикеров (стикеры уже ушли каскадом вместе с файлами).
  const sets = has.stickerSets ? await prisma.$executeRawUnsafe(`DELETE FROM sticker_sets`) : 0

  const [after] = await prisma.$queryRawUnsafe(
    `SELECT count(*) AS files FROM files f WHERE ${fileWhere}`,
    CHAT_BUCKET,
  )

  const summary = [
    '## Уборка картинок чатов',
    '',
    '| | |',
    '|---|---|',
    `| Сообщений удалено (у всех) | ${messages} |`,
    `| Превью ссылок без картинки | ${previews} |`,
    `| Строк files удалено | ${filesDeleted} |`,
    `| Объектов MinIO снято | ${objectsRemoved} |`,
    `| Объектов MinIO не снято | ${objectsFailed} |`,
    `| Наборов стикеров удалено | ${sets} |`,
    `| Осталось строк-картинок чатов | ${n(after.files)} |`,
    '',
  ].join('\n')
  console.log(summary)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  if (n(after.files) > 0 || objectsFailed > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
