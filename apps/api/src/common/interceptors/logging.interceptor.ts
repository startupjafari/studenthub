import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { clientVersionFrom } from '../logging/client-version'

// Логирует завершение каждого HTTP-запроса с requestId, методом, путём, статусом и длительностью.
// requestId проставляется pino-http (genReqId) в req.id.
//
// clientVersion добавляется, только когда клиент его прислал (мобильное приложение,
// план iOS Задача Б3): у веба заголовка нет, и пустое поле в каждой строке лога
// только мешало бы читать.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@InjectPinoLogger(LoggingInterceptor.name) private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const startedAt = Date.now()
    const { method, url } = request
    const requestId = request.id
    const clientVersion = clientVersionFrom(request)

    const log = (statusCode: number): void => {
      this.logger.info(
        {
          requestId,
          method,
          path: url,
          statusCode,
          durationMs: Date.now() - startedAt,
          ...(clientVersion ? { clientVersion } : {}),
        },
        `${method} ${url} ${statusCode}`,
      )
    }

    return next.handle().pipe(
      tap({
        next: () => log(http.getResponse<FastifyReply>().statusCode),
        error: (err: { status?: number }) => log(err?.status ?? 500),
      }),
    )
  }
}
