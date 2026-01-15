import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../../../common/services/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * Проверка подключения к базе данных PostgreSQL
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // Выполняем простой запрос для проверки соединения
      await this.prisma.$queryRaw`SELECT 1`;

      return this.getStatus(key, true, {
        message: 'PostgreSQL подключен',
      });
    } catch (error) {
      throw new HealthCheckError(
        'Проверка Prisma не прошла',
        this.getStatus(key, false, {
          message: 'PostgreSQL недоступен',
          error: error.message,
        }),
      );
    }
  }
}
