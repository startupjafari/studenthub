import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../modules/redis.module';
import Redis from 'ioredis';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface RateLimitOptions {
  windowMs: number; // Временное окно в миллисекундах
  max: number; // Максимум запросов за окно
  message?: string;
}

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly defaultOptions: RateLimitOptions = {
    windowMs: 60000, // 1 минута
    max: 100, // 100 запросов в минуту
    message: 'Слишком много запросов с этого IP, попробуйте позже',
  };

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Применяем только к публичным endpoints
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isPublic) {
      return true; // Пропускаем IP rate limiting для аутентифицированных endpoints
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);

    // Получаем настройки rate limit из метаданных (если есть)
    const options = this.defaultOptions;

    const key = `rate_limit:ip:${ip}`;
    const current = await this.redis.incr(key);

    if (current === 1) {
      // Первый запрос в окне, устанавливаем время жизни
      await this.redis.pexpire(key, options.windowMs);
    }

    if (current > options.max) {
      const ttl = await this.redis.pttl(key);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: options.message,
          retryAfter: Math.ceil(ttl / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /**
   * Получить IP адрес клиента
   */
  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }
}
