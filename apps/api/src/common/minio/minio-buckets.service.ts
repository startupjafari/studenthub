import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TTL } from '@studenthub/shared-config'
import type { Client as MinioClient } from 'minio'
import type { EnvVars } from '../../config/env.schema'
import { MINIO_CLIENT } from './minio.constants'

// Политика доступа бакета: публичный (прямой GET по URL) или приватный (только presigned).
type BucketAccess = 'public' | 'private'

interface BucketSpec {
  name: string
  access: BucketAccess
  // Срок жизни объектов в днях (TTL-политика). Задаётся только для stories-media.
  expireDays?: number
}

// Публичная read-only политика: любой может скачать объект по прямому URL (docs/PROJECT.md §5.5).
function publicReadPolicy(bucket: string): string {
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

/**
 * Создаёт бакеты и применяет их политики на старте приложения
 * (docs/PROJECT.md §5.5, docs/BACKEND_RULES.md §8):
 *   avatars       — публичный;
 *   posts-media   — приватный;
 *   stories-media — приватный + TTL 24ч;
 *   applications  — приватный.
 * Идемпотентно: повторный запуск не пересоздаёт существующие бакеты.
 * При недоступности MinIO не роняет приложение — ошибка логируется, health-индикатор
 * сообщит о проблеме (graceful degradation, docs/PROJECT.md Приложение А).
 */
@Injectable()
export class MinioBucketsService implements OnModuleInit {
  private readonly logger = new Logger(MinioBucketsService.name)

  constructor(
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const specs: BucketSpec[] = [
      { name: this.config.get('MINIO_BUCKET_AVATARS', { infer: true }), access: 'public' },
      { name: this.config.get('MINIO_BUCKET_POSTS', { infer: true }), access: 'private' },
      {
        name: this.config.get('MINIO_BUCKET_STORIES', { infer: true }),
        access: 'private',
        expireDays: Math.ceil(TTL.STORY_HOURS / 24),
      },
      { name: this.config.get('MINIO_BUCKET_APPLICATIONS', { infer: true }), access: 'private' },
      { name: this.config.get('MINIO_BUCKET_MATERIALS', { infer: true }), access: 'private' },
      { name: this.config.get('MINIO_BUCKET_CHAT', { infer: true }), access: 'private' },
      // Медиа профиля (фото/видео) — публичный бакет, как avatars: контент виден на профиле.
      { name: this.config.get('MINIO_BUCKET_PROFILE_MEDIA', { infer: true }), access: 'public' },
      // Обложки статей профиля — публичный бакет (отдельно от галереи, чтобы не попадать в «Фото»).
      { name: this.config.get('MINIO_BUCKET_PROFILE_COVERS', { infer: true }), access: 'public' },
      // Документы (Ф15) — строго приватный: доступ только по presigned-URL с проверкой прав.
      { name: this.config.get('MINIO_BUCKET_DOCUMENTS', { infer: true }), access: 'private' },
    ]

    for (const spec of specs) {
      try {
        await this.ensureBucket(spec)
      } catch (err) {
        this.logger.error(
          `Не удалось инициализировать бакет "${spec.name}": ${(err as Error).message}`,
        )
      }
    }
  }

  private async ensureBucket(spec: BucketSpec): Promise<void> {
    const exists = await this.minio.bucketExists(spec.name)
    if (!exists) {
      await this.minio.makeBucket(spec.name)
      this.logger.log(`Бакет "${spec.name}" создан`)
    }

    if (spec.access === 'public') {
      await this.minio.setBucketPolicy(spec.name, publicReadPolicy(spec.name))
    }

    if (spec.expireDays !== undefined) {
      await this.minio.setBucketLifecycle(spec.name, {
        Rule: [
          {
            ID: `expire-after-${spec.expireDays}d`,
            Status: 'Enabled',
            Filter: { Prefix: '' },
            Expiration: { Days: spec.expireDays },
          },
        ],
      })
    }
  }
}
