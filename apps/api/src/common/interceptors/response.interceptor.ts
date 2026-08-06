import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { ApiSuccessResponse } from '@studenthub/shared-types'
import { Paginated } from '../http/paginated'

// Глобально оборачивает ответ контроллера в { success: true, data, meta? }.
// Контроллеры возвращают чистые данные (docs/BACKEND_RULES.md §4.1).
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<unknown>> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<unknown>> {
    return next.handle().pipe(
      map((data): ApiSuccessResponse<unknown> => {
        if (data instanceof Paginated) {
          return { success: true, data: data.items, meta: data.meta }
        }
        return { success: true, data: data ?? null }
      }),
    )
  }
}
