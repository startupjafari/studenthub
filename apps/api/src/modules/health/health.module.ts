import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
import { HealthController } from './health.controller'
import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'
import { MinioHealthIndicator } from './indicators/minio.health'

// Индикаторы экспортируются, потому что состояние зависимостей должно иметь один источник:
// служебный канал (docs/TELEGRAM_BOT.md §7.1.5) читает те же проверки, что и `GET /health`.
// Свои запросы к Postgres и MinIO разошлись бы с этими — и не осталось бы ответа, чему верить.
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, MinioHealthIndicator],
  exports: [PrismaHealthIndicator, RedisHealthIndicator, MinioHealthIndicator],
})
export class HealthModule {}
