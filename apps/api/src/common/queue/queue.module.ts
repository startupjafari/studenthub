import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'
import type { EnvVars } from '../../config/env.schema'
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from './queue.constants'
import { QueueService } from './queue.service'

// Инфраструктура очередей BullMQ поверх Redis (docs/PROJECT.md §10, docs/BACKEND_RULES.md §9).
// BullMQ держит собственные ioredis-соединения (требует maxRetriesPerRequest: null),
// поэтому не переиспользуем общий REDIS_CLIENT, а конфигурируем из тех же env.
// Глобальный модуль: очереди и QueueService доступны любому модулю без повторного импорта.
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvVars, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
