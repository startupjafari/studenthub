import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public, MaintenanceExempt } from '../../common/decorators'
import { PrismaHealthIndicator } from './indicators/prisma.health'
import { RedisHealthIndicator } from './indicators/redis.health'
import { MinioHealthIndicator } from './indicators/minio.health'

@ApiTags('Служебное')
// Без живости хостинг решит, что контейнер умер, и будет перезапускать его по кругу — техработы превратились бы в аварию.
@MaintenanceExempt()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly minio: MinioHealthIndicator,
  ) {}

  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Проверка живости зависимостей: Prisma, Redis, MinIO' })
  // Формат terminus прежний (`status`, `info`, `error`, `details` по ключам database/redis/
  // minio): его читают Railway, uptime-проверка и мини-апп. У каждой зависимости — только
  // `status`: маршрут публичный, причины отказа пишутся в журнал (B-F23). Каждая проба
  // ограничена HEALTH_PROBE_TIMEOUT_MS, и пробы идут параллельно.
  check() {
    return this.health.check([
      () => this.prisma.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.minio.isHealthy('minio'),
    ])
  }
}
