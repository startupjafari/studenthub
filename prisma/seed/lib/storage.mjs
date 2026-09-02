// Работа с MinIO из сида: клиент, бакеты, загрузка объектов, публичные URL.
//
// Клиент берём из зависимостей apps/api через createRequire: пакет `minio` там уже есть,
// а добавлять его в корневой package.json — это новая зависимость репозитория
// (стоп-точка по AGENTS.md) ради скрипта, который и так живёт рядом с API.
//
// ВАЖНО: у каждого загруженного объекта ОБЯЗАН быть File-строка в БД. Cron
// cleanOrphanFiles (apps/api/src/modules/cleanup) раз в сутки удаляет из бакетов
// avatars/posts-media/stories-media/applications всё, на что нет записи File. Без
// File-строк медиа сида исчезло бы на следующую ночь.

import { createRequire } from 'node:module'
import { loadEnv } from './env.mjs'

const requireFromApi = createRequire(new URL('../../../apps/api/package.json', import.meta.url))

// Публичная read-only политика — та же, что применяет MinioBucketsService на старте API.
function publicReadPolicy(bucket) {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  })
}

export function createStorage() {
  const env = loadEnv()
  const { Client } = requireFromApi('minio')

  const endpoint = env.MINIO_ENDPOINT ?? 'localhost'
  const port = Number(env.MINIO_PORT ?? 9000)
  const useSSL = String(env.MINIO_USE_SSL ?? 'false') === 'true'

  const client = new Client({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey: env.MINIO_ACCESS_KEY ?? '',
    secretKey: env.MINIO_SECRET_KEY ?? '',
  })

  const buckets = {
    avatars: env.MINIO_BUCKET_AVATARS ?? 'avatars',
    posts: env.MINIO_BUCKET_POSTS ?? 'posts-media',
    chat: env.MINIO_BUCKET_CHAT ?? 'chat-media',
    materials: env.MINIO_BUCKET_MATERIALS ?? 'materials',
    documents: env.MINIO_BUCKET_DOCUMENTS ?? 'documents',
    profileMedia: env.MINIO_BUCKET_PROFILE_MEDIA ?? 'profile-media',
    profileCovers: env.MINIO_BUCKET_PROFILE_COVERS ?? 'profile-covers',
  }
  // Публичные бакеты — те, из которых объект отдаётся по постоянному URL
  // (docs/BACKEND_RULES.md §8). Приватные читаются только по presigned-ссылке.
  const PUBLIC_BUCKETS = new Set([buckets.avatars, buckets.profileMedia, buckets.profileCovers])

  // Постоянный публичный URL — та же схема, что buildPublicObjectUrl в apps/api.
  function publicUrl(bucket, key) {
    const pubEndpoint = env.MINIO_PUBLIC_ENDPOINT || null
    const host = pubEndpoint ?? endpoint
    const ssl = pubEndpoint ? String(env.MINIO_PUBLIC_USE_SSL ?? 'true') === 'true' : useSSL
    const p = pubEndpoint ? Number(env.MINIO_PUBLIC_PORT ?? 443) : port
    const isDefaultPort = (ssl && p === 443) || (!ssl && p === 80)
    return `${ssl ? 'https' : 'http'}://${isDefaultPort ? host : `${host}:${p}`}/${bucket}/${key}`
  }

  return {
    client,
    buckets,
    publicUrl,

    async isAvailable() {
      try {
        await client.listBuckets()
        return true
      } catch {
        return false
      }
    },

    // Бакеты обычно создаёт API на старте; сид может работать и без запущенного API,
    // поэтому создаёт отсутствующие сам — с той же политикой.
    async ensureBuckets() {
      for (const bucket of new Set(Object.values(buckets))) {
        if (!(await client.bucketExists(bucket))) {
          await client.makeBucket(bucket)
        }
        if (PUBLIC_BUCKETS.has(bucket)) {
          await client.setBucketPolicy(bucket, publicReadPolicy(bucket)).catch(() => {})
        }
      }
    },

    // Серверная копия объекта внутри MinIO: байты по сети не гоняются, копирование
    // делает сам сервер. Так «изображение у поста» получается из УЖЕ скачанного пула —
    // отдельная File-строка на пост нужна по схеме (File.postId эксклюзивен, объект
    // уникален по bucket+key), а вот качать что-то заново незачем.
    async copyIfAbsent(bucket, key, sourceBucket, sourceKey) {
      try {
        await client.statObject(bucket, key)
        return false
      } catch {
        // объекта нет — копируем
      }
      const { CopyConditions } = requireFromApi('minio')
      await client.copyObject(bucket, key, `/${sourceBucket}/${sourceKey}`, new CopyConditions())
      return true
    },

    // Загрузка с пропуском уже загруженного: сравниваем размер объекта в бакете.
    // Так повторный прогон сида не перекачивает гигабайты в MinIO.
    async putIfAbsent(bucket, key, filePath, size, mime) {
      try {
        const stat = await client.statObject(bucket, key)
        if (stat.size === size) return false
      } catch {
        // объекта нет — грузим
      }
      await client.fPutObject(bucket, key, filePath, { 'Content-Type': mime })
      return true
    },
  }
}
