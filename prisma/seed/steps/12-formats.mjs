// Шаг «образцы форматов»: залить в MinIO файлы из prisma/seed/formats/ — по одному каждого
// формата, который принимает платформа, — во все бакеты модулей с вложениями.
//
// Общий, не по вузу: объект один на бакет, а вузы ссылаются на него строками File (см.
// lib/formats.mjs). У каждого объекта есть базовая строка File без привязки — без неё ночная
// уборка сирот (cleanOrphanFiles) удалила бы объект из бакета.
//
// Идемпотентно: putIfAbsent сверяет размер объекта, File — upsert по фиксированному id.

import { join } from 'node:path'
import {
  FORMAT_BUCKETS,
  FORMAT_CATALOG,
  FORMATS_DIR,
  formatBaseFileId,
  formatKey,
} from '../lib/formats.mjs'

export async function seedFormats(prisma, storage) {
  if (!storage || !(await storage.isAvailable())) {
    console.log('  образцы форматов: MinIO недоступен — пропущено')
    return { uploaded: 0, total: 0 }
  }
  await storage.ensureBuckets()
  const admin = await prisma.user.findFirst({
    where: { role: 'PLATFORM_ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) throw new Error('Нет PLATFORM_ADMIN — сначала должен пройти основной сид')

  let uploaded = 0
  let total = 0
  for (const bucketKey of FORMAT_BUCKETS) {
    const bucket = storage.buckets[bucketKey]
    if (!bucket) continue
    for (const item of FORMAT_CATALOG) {
      const key = formatKey(item.file)
      if (
        await storage.putIfAbsent(bucket, key, join(FORMATS_DIR, item.file), item.size, item.mime)
      ) {
        uploaded += 1
      }
      total += 1
      const id = formatBaseFileId(bucketKey, item.file)
      const data = {
        bucket,
        key,
        mime: item.mime,
        size: item.size,
        name: item.names[0],
        ownerId: admin.id,
        ...(item.width ? { width: item.width, height: item.height } : {}),
        ...(item.durationMs ? { durationMs: item.durationMs } : {}),
      }
      await prisma.file.upsert({ where: { id }, update: data, create: { id, ...data } })
    }
  }
  console.log(
    `  образцы форматов: ${FORMAT_CATALOG.length} форматов × ${FORMAT_BUCKETS.length} бакетов, ` +
      `выгружено ${uploaded} из ${total}`,
  )
  return { uploaded, total }
}
