import { Inject, Injectable, Logger } from '@nestjs/common'
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../../common/redis/redis.module'
import { probe } from './probe'

@Injectable()
export class RedisHealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name)

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  isHealthy(key: string): Promise<HealthIndicatorResult> {
    return probe(this.healthIndicatorService, key, this.logger, async () => {
      const pong = await this.redis.ping()
      if (pong !== 'PONG') throw new Error(`Неожиданный ответ Redis: ${pong}`)
    })
  }
}
