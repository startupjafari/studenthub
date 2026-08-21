import { Global, Module, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import Redis from 'ioredis'
import type { EnvVars } from '../../config/env.schema'
import { CronLockService } from './cron-lock.service'
import { REDIS_CLIENT } from './redis.constants'

// Ре-экспорт для существующих импортов `from './redis.module'`.
export { REDIS_CLIENT }

// Глобальный ioredis-клиент. Используется health-индикатором; с Фазы 3 — BullMQ и кэшем.
// lazyConnect: соединение открывается при первой команде, чтобы старт не падал раньше health-проверки.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) =>
        new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          // family: 0 — dual-stack DNS: приватная сеть Railway (*.railway.internal) отдаёт
          // только IPv6, а ioredis по умолчанию идёт по IPv4 → connect ETIMEDOUT. Локально безвредно.
          family: 0,
          lazyConnect: true,
          // Кэш-клиент (не BullMQ): команды обязаны БЫСТРО падать при недоступном Redis,
          // а не висеть в offline-очереди бесконечно (иначе запрос-инициатор зависает —
          // напр. счётчик непрочитанных). commandTimeout ограничивает ожидание, retries
          // не бесконечны. Вызовы кэша обёрнуты в try/catch и деградируют к БД.
          maxRetriesPerRequest: 3,
          commandTimeout: 3000,
        }),
    },
    CronLockService,
  ],
  exports: [REDIS_CLIENT, CronLockService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS_CLIENT, { strict: false })
    if (client) {
      client.disconnect()
    }
  }
}
