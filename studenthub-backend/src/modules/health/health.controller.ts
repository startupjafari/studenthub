import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  /**
   * Базовая проверка здоровья - быстрая проверка что сервер работает
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Базовая проверка здоровья' })
  @ApiResponse({ status: 200, description: 'Сервер работает' })
  @HealthCheck()
  check() {
    return this.health.check([
      // Проверка базы данных
      () => this.prismaHealth.isHealthy('database'),
      // Проверка Redis
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }

  /**
   * Готовность к работе - проверка всех зависимостей
   */
  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Проверка готовности к работе' })
  @ApiResponse({ status: 200, description: 'Сервис готов к работе' })
  @HealthCheck()
  checkReady() {
    return this.health.check([
      // Проверка базы данных
      () => this.prismaHealth.isHealthy('database'),
      // Проверка Redis
      () => this.redisHealth.isHealthy('redis'),
      // Проверка памяти (не более 500MB heap)
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      // Проверка RSS памяти (не более 1GB)
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
    ]);
  }

  /**
   * Живость сервиса - для Kubernetes liveness probe
   */
  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Проверка живости сервиса' })
  @ApiResponse({ status: 200, description: 'Сервис жив' })
  live() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  /**
   * Детальная информация о системе
   */
  @Get('info')
  @Public()
  @ApiOperation({ summary: 'Информация о системе' })
  @ApiResponse({ status: 200, description: 'Информация о системе' })
  info() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memory: {
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      },
    };
  }
}





