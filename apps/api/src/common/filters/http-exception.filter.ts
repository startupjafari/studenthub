import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino'
import { ZodValidationException } from 'nestjs-zod'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  errorCodeFromStatus,
  type ApiErrorResponse,
  type ErrorCode,
  type ErrorDetail,
} from '@studenthub/shared-types'
import { AppException } from '../exceptions/app.exception'
import type { CurrentUserData } from '../auth/jwt-payload.type'
import { captureException } from '../monitoring/sentry'

// Глобальный фильтр: любую ошибку приводит к контракту
// { success:false, error:{ code, message, details? }, statusCode, timestamp, path }.
// Stack trace наружу не отдаётся никогда (docs/BACKEND_RULES.md §4.2/§4.4).
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(HttpExceptionFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<FastifyRequest>()
    const reply = ctx.getResponse<FastifyReply>()

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR
    let code: ErrorCode = 'INTERNAL_ERROR'
    let message = 'Внутренняя ошибка сервера'
    let details: ErrorDetail[] | undefined

    if (exception instanceof ZodValidationException) {
      status = HttpStatus.UNPROCESSABLE_ENTITY
      code = 'VALIDATION_ERROR'
      message = 'Ошибка валидации'
      details = exception.getZodError().issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }))
    } else if (exception instanceof AppException) {
      status = exception.getStatus()
      code = exception.code
      message = exception.message
      details = exception.details
    } else if (exception instanceof HttpException) {
      status = exception.getStatus()
      code = errorCodeFromStatus(status)
      message = extractMessage(exception.getResponse()) ?? message
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Страховочный централизованный маппинг known-ошибок Prisma в корректный HTTP-контракт
      // (§4.4): сервисы должны конвертировать сами, но там, где забыли, отдаём 409/404/400,
      // а не 500. Тело записи наружу не отдаём — только человекочитаемый message.
      const mapped = mapPrismaError(exception.code)
      if (mapped) {
        status = mapped.status
        code = mapped.code
        message = mapped.message
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Необработанное/серверное — логируем с полным контекстом (но не в ответ)
      // и отправляем в Sentry (Ф13.8). Порог тот же, что у лога: 5xx = наш баг,
      // 4xx = ожидаемый отказ, его в трекер не шлём (иначе шум от 401/403/404).
      //
      // Захват именно здесь, а не декоратором @SentryExceptionCaptured: декоратор
      // считает «ожидаемым» любой HttpException, включая наш AppException с 500-м
      // статусом, и не даёт приложить requestId/userId для склейки с логами pino.
      const userId = (request as FastifyRequest & { user?: CurrentUserData }).user?.sub
      const eventId = captureException(exception, {
        source: 'http',
        requestId: String(request.id),
        userId,
        path: request.url,
        method: request.method,
        code,
      })
      this.logger.error(
        {
          err: exception,
          path: request.url,
          method: request.method,
          ...(eventId ? { sentryEventId: eventId } : {}),
        },
        'Необработанное исключение',
      )
    }

    const body: ApiErrorResponse = {
      success: false,
      error: { code, message, ...(details && details.length > 0 ? { details } : {}) },
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    }

    void reply.status(status).send(body)
  }
}

// Маппинг кодов Prisma → HTTP-контракт. null = оставить 500 (неожиданная ошибка данных = баг).
function mapPrismaError(
  prismaCode: string,
): { status: number; code: ErrorCode; message: string } | null {
  switch (prismaCode) {
    case 'P2002': // unique constraint
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'Запись с такими данными уже существует',
      }
    case 'P2025': // record not found (update/delete)
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Запись не найдена' }
    case 'P2003': // foreign key constraint
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'Нарушение ссылочной целостности',
      }
    default:
      return null
  }
}

function extractMessage(response: string | object): string | undefined {
  if (typeof response === 'string') {
    return response
  }
  const maybe = response as { message?: string | string[] }
  if (Array.isArray(maybe.message)) {
    return maybe.message.join('; ')
  }
  return maybe.message
}
