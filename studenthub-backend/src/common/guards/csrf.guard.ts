import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Пропускаем CSRF проверку для публичных endpoints
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // Проверяем CSRF только для методов, изменяющих состояние
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return true;
    }

    // Получаем CSRF токен из заголовка
    const csrfToken = request.headers['x-csrf-token'] as string;
    const sessionToken = request.cookies?.['csrf-token'];

    // В режиме разработки разрешаем запросы без CSRF токена для упрощения тестирования
    // В продакшене CSRF обязателен
    if (process.env.NODE_ENV === 'development') {
      if (!csrfToken && !sessionToken) {
        return true; // Разрешаем в dev режиме если нет токенов
      }
      // Если токены предоставлены в dev режиме, валидируем их
      if (csrfToken && sessionToken) {
        if (!this.constantTimeCompare(csrfToken, sessionToken)) {
          throw new ForbiddenException('Неверный CSRF токен');
        }
        return true;
      }
    }

    // Продакшен: CSRF токен обязателен
    if (!csrfToken || !sessionToken) {
      throw new ForbiddenException('CSRF токен отсутствует');
    }

    // Используем сравнение за постоянное время для предотвращения timing-атак
    if (!this.constantTimeCompare(csrfToken, sessionToken)) {
      throw new ForbiddenException('Неверный CSRF токен');
    }

    return true;
  }

  /**
   * Сравнение строк за постоянное время для предотвращения timing-атак
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}
