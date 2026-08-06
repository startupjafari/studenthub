import { Global, Module, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ModuleRef } from '@nestjs/core'
import Redis from 'ioredis'
import type { EnvVars } from '../../config/env.schema'

export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

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
          lazyConnect: true,
          maxRetriesPerRequest: null,
        }),
    },
  ],
  exports: [REDIS_CLIENT],
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
