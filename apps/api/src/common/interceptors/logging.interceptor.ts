import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { FastifyReply, FastifyRequest } from 'fastify'

// Логирует завершение каждого HTTP-запроса с requestId, методом, путём, статусом и длительностью.
// requestId проставляется pino-http (genReqId) в req.id.
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

    const log = (statusCode: number): void => {
      this.logger.info(
        { requestId, method, path: url, statusCode, durationMs: Date.now() - startedAt },
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
