import { Injectable, Inject } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { REDIS_CLIENT } from '../../../common/modules/redis.module';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  /**
   * Проверка подключения к Redis
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Выполняем PING для проверки соединения
      const result = await this.redis.ping();
      
      if (result === 'PONG') {
        // Получаем информацию о Redis
        const info = await this.redis.info('memory');
        const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';
        
        return this.getStatus(key, true, {
          message: 'Redis подключен',
          usedMemory,
        });
      }
      
      throw new Error('Неожиданный ответ от Redis');
    } catch (error) {
      throw new HealthCheckError(
        'Проверка Redis не прошла',
        this.getStatus(key, false, {
          message: 'Redis недоступен',
          error: error.message,
        }),
      );
    }
  }
}





