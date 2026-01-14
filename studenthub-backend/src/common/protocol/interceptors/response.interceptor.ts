import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { ApiSuccessResponse } from '../interfaces/response.interface';
import { ResponseUtil } from '../utils/response.util';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request & { id?: string }>();
    const requestId = (request as any).id || request.headers['x-request-id'];

    return next.handle().pipe(
      map((data) => {
        // Если ответ уже обернут в стандартный формат, возвращаем как есть
        if (data && typeof data === 'object' && 'success' in data) {
          return data;
        }

        // Обертываем данные в стандартный формат
        return ResponseUtil.success(data, {
          requestId,
          version: process.env.API_VERSION || '1.0',
        });
      }),
    );
  }
}

