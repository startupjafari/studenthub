import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
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
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Необработанное/серверное — логируем с полным контекстом (но не в ответ).
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
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
