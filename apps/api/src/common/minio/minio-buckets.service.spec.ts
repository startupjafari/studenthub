import type { ConfigService } from '@nestjs/config'
import type { Client as MinioClient } from 'minio'
import type { EnvVars } from '../../config/env.schema'
import { MinioBucketsService } from './minio-buckets.service'

type Mock = jest.Mock

function makeService(existing: string[] = []) {
  const minio = {
    bucketExists: jest.fn(async (name: string) => existing.includes(name)) as Mock,
    makeBucket: jest.fn(async () => undefined) as Mock,
    setBucketPolicy: jest.fn(async () => undefined) as Mock,
    setBucketLifecycle: jest.fn(async () => undefined) as Mock,
  }
  // Имя бакета = имя переменной окружения: так в проверках видно, какой бакет какой.
  const config = { get: jest.fn((key: string) => key) as Mock }
  const service = new MinioBucketsService(
    minio as unknown as MinioClient,
    config as unknown as ConfigService<EnvVars, true>,
  )
  return { service, minio }
}

const ALL_BUCKETS = [
  'MINIO_BUCKET_AVATARS',
  'MINIO_BUCKET_POSTS',
  'MINIO_BUCKET_STORIES',
  'MINIO_BUCKET_APPLICATIONS',
  'MINIO_BUCKET_MATERIALS',
  'MINIO_BUCKET_CHAT',
  'MINIO_BUCKET_PROFILE_MEDIA',
  'MINIO_BUCKET_PROFILE_COVERS',
  'MINIO_BUCKET_DOCUMENTS',
]

describe('MinioBucketsService', () => {
  it('создаёт недостающие бакеты и не пересоздаёт существующие', async () => {
    const { service, minio } = makeService(['MINIO_BUCKET_POSTS'])

    await service.onModuleInit()

    const created = minio.makeBucket.mock.calls.map(([name]) => name)
    expect(created).toEqual(ALL_BUCKETS.filter((name) => name !== 'MINIO_BUCKET_POSTS'))
  })

  it('публичную политику ставит только публичным бакетам', async () => {
    const { service, minio } = makeService(ALL_BUCKETS)

    await service.onModuleInit()

    const publicBuckets = minio.setBucketPolicy.mock.calls.map(([name]) => name)
    expect(publicBuckets).toEqual([
      'MINIO_BUCKET_AVATARS',
      'MINIO_BUCKET_PROFILE_MEDIA',
      'MINIO_BUCKET_PROFILE_COVERS',
    ])
    const policy = JSON.parse(minio.setBucketPolicy.mock.calls[0][1] as string)
    expect(policy.Statement[0].Action).toEqual(['s3:GetObject'])
    expect(policy.Statement[0].Resource).toEqual(['arn:aws:s3:::MINIO_BUCKET_AVATARS/*'])
  })

  it('TTL ставит только сторис — одним правилом Expiration', async () => {
    const { service, minio } = makeService(ALL_BUCKETS)

    await service.onModuleInit()

    expect(minio.setBucketLifecycle).toHaveBeenCalledTimes(1)
    const [bucket, lifecycle] = minio.setBucketLifecycle.mock.calls[0]
    expect(bucket).toBe('MINIO_BUCKET_STORIES')
    expect(lifecycle).toEqual({
      Rule: [
        {
          ID: 'expire-after-1d',
          Status: 'Enabled',
          Filter: { Prefix: '' },
          Expiration: { Days: 1 },
        },
      ],
    })
  })

  it('не добавляет правило AbortIncompleteMultipartUpload — MinIO его отвергает', async () => {
    // MinIO (pgsty/minio 2026-08-04, minio/minio 2025-04-22) отвечает на такое правило
    // InvalidArgument, и вся конфигурация не встаёт — вместе с TTL сторис. Уборку брошенных
    // загрузок делают MINIO_API_STALE_UPLOADS_EXPIRY и sweepIncompleteUploads.
    const { service, minio } = makeService(ALL_BUCKETS)

    await service.onModuleInit()

    for (const [, lifecycle] of minio.setBucketLifecycle.mock.calls) {
      for (const rule of (lifecycle as { Rule: Record<string, unknown>[] }).Rule) {
        expect(rule).not.toHaveProperty('AbortIncompleteMultipartUpload')
      }
    }
  })

  it('сбой одного бакета не роняет запуск и не мешает остальным', async () => {
    const { service, minio } = makeService()
    minio.makeBucket.mockImplementation(async (name: string) => {
      if (name === 'MINIO_BUCKET_POSTS') throw new Error('access denied')
    })

    await expect(service.onModuleInit()).resolves.toBeUndefined()

    expect(minio.makeBucket).toHaveBeenCalledTimes(ALL_BUCKETS.length)
    expect(minio.setBucketLifecycle).toHaveBeenCalledWith('MINIO_BUCKET_STORIES', expect.anything())
  })

  it('недоступный MinIO не роняет запуск', async () => {
    const { service, minio } = makeService()
    minio.bucketExists.mockRejectedValue(new Error('connect ECONNREFUSED'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()

    expect(minio.makeBucket).not.toHaveBeenCalled()
  })
})
