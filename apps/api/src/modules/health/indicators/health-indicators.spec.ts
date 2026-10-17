import { HealthIndicatorService } from '@nestjs/terminus'
import type Redis from 'ioredis'
import type { Client as MinioClient } from 'minio'
import type { PrismaService } from '../../../common/prisma/prisma.service'
import { MinioHealthIndicator } from './minio.health'
import { HEALTH_PROBE_TIMEOUT_MS } from './probe'
import { PrismaHealthIndicator } from './prisma.health'
import { RedisHealthIndicator } from './redis.health'

// B-F23: `GET /health` публичный — наружу только статус, без текста ошибок зависимостей,
// и подвисшая зависимость не подвешивает весь ответ.
const indicators = new HealthIndicatorService()

// Как выглядит настоящий отказ: в тексте — внутренний хост и порт.
const LEAKY = new Error('connect ECONNREFUSED postgres.railway.internal:5432')

function prismaWith(queryRaw: jest.Mock) {
  return new PrismaHealthIndicator(indicators, { $queryRaw: queryRaw } as unknown as PrismaService)
}

describe('индикаторы здоровья', () => {
  afterEach(() => jest.useRealTimers())

  it('база отвечает → up', async () => {
    const result = await prismaWith(jest.fn().mockResolvedValue([{ '?column?': 1 }])).isHealthy(
      'database',
    )
    expect(result).toEqual({ database: { status: 'up' } })
  })

  it('отказ базы → down без текста ошибки', async () => {
    const result = await prismaWith(jest.fn().mockRejectedValue(LEAKY)).isHealthy('database')
    expect(result).toEqual({ database: { status: 'down' } })
    expect(JSON.stringify(result)).not.toContain('railway.internal')
  })

  it('Redis отвечает не PONG → down без подробностей', async () => {
    const redis = { ping: jest.fn().mockResolvedValue('LOADING') }
    const result = await new RedisHealthIndicator(indicators, redis as unknown as Redis).isHealthy(
      'redis',
    )
    expect(result).toEqual({ redis: { status: 'down' } })
  })

  it('Redis отвечает PONG → up', async () => {
    const redis = { ping: jest.fn().mockResolvedValue('PONG') }
    const result = await new RedisHealthIndicator(indicators, redis as unknown as Redis).isHealthy(
      'redis',
    )
    expect(result).toEqual({ redis: { status: 'up' } })
  })

  it('подвисший MinIO → down по таймауту, а не вечное ожидание', async () => {
    jest.useFakeTimers()
    const minio = { listBuckets: jest.fn().mockReturnValue(new Promise(() => undefined)) }
    const pending = new MinioHealthIndicator(indicators, minio as unknown as MinioClient).isHealthy(
      'minio',
    )
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_TIMEOUT_MS)
    await expect(pending).resolves.toEqual({ minio: { status: 'down' } })
  })

  it('проба, бросившая синхронно, тоже даёт down, а не 500', async () => {
    const minio = {
      listBuckets: jest.fn(() => {
        throw LEAKY
      }),
    }
    const result = await new MinioHealthIndicator(
      indicators,
      minio as unknown as MinioClient,
    ).isHealthy('minio')
    expect(result).toEqual({ minio: { status: 'down' } })
  })
})
