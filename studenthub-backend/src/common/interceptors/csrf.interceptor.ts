import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CsrfInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse<Response>();

    // Пропускаем для WebSocket соединений
    if (request.ws) {
      return next.handle();
    }

    // Генерируем CSRF токен если его нет
    const existingToken = request.cookies?.['csrf-token'];
    if (!existingToken) {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      response.cookie('csrf-token', csrfToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
      });
      response.locals.csrfToken = csrfToken;
    } else {
      response.locals.csrfToken = existingToken;
    }

    return next.handle();
  }
}
