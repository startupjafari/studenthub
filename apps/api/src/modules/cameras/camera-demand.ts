import { Inject, Injectable } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'

// Сколько живёт «спрос» на поток камеры без продления. Плеер продлевает его каждые ~30 с;
// закрыли вкладку — через минуту агент перестаёт отдавать поток.
export const DEMAND_TTL_MS = 60_000

const key = (cameraId: string): string => `camera:demand:${cameraId}`

/**
 * Спрос на поток камеры (docs/PROJECT.md §3.10): агент отдаёт видео наружу, только пока
 * его кто-то смотрит. Ключ в Redis с TTL — истечёт сам, даже если плеер не сказал «стоп».
 */
@Injectable()
export class CameraDemand {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async mark(cameraId: string): Promise<void> {
    await this.redis.set(key(cameraId), '1', 'PX', DEMAND_TTL_MS)
  }

  /** Какие из камер сейчас кто-то смотрит. */
  async active(cameraIds: string[]): Promise<Set<string>> {
    if (cameraIds.length === 0) return new Set()
    const values = await this.redis.mget(cameraIds.map(key))
    return new Set(cameraIds.filter((_, i) => values[i] !== null))
  }
}
