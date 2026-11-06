import { Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { loggerConfig } from './logging/logger.config'
import { HttpExceptionFilter } from './filters/http-exception.filter'
import { ResponseInterceptor } from './interceptors/response.interceptor'

// Регистрирует все глобальные кросс-каттинг-компоненты (docs/BACKEND_RULES.md §3, §4, §13).
// Access-лог — не перехватчик, а хук Fastify `onResponse` (logging/access-log.ts, main.ts):
// перехватчику не видны отказы guard'ов и настоящий статус ответа.
@Module({
  imports: [LoggerModule.forRoot(loggerConfig)],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class CommonModule {}
