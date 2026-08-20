// ПЕРВЫЙ импорт: Sentry.init должен выполниться раньше загрузки Nest и инструментируемых
// библиотек (Ф13.8). Без SENTRY_DSN — no-op. Порядок значим, не переставлять.
import { sentryEnabled } from './instrument'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { IoAdapter } from '@nestjs/platform-socket.io'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Logger as PinoLogger } from 'nestjs-pino'
import { FILE_UPLOAD } from '@studenthub/shared-config'
import { AppModule } from './app.module'
import type { EnvVars } from './config/env.schema'

async function bootstrap(): Promise<void> {
  // requestId: берём входящий x-request-id или генерируем uuid (docs/BACKEND_RULES.md §13).
  const adapter = new FastifyAdapter({
    genReqId: (req: IncomingMessage): string => {
      const header = req.headers['x-request-id']
      return (Array.isArray(header) ? header[0] : header) ?? randomUUID()
    },
    // §14.5 — в проде API стоит за nginx (docker/nginx/nginx.conf), который проставляет
    // X-Forwarded-For/X-Real-IP. Без trustProxy req.ip у всех клиентов = внутренний IP nginx,
    // из-за чего IP-throttling логина (auth.controller.ts) становится общим на всю платформу
    // (DoS на аутентификацию), а аудит пишет IP прокси вместо реального клиента.
    // Доверяем РОВНО одному хопу (наша единственная прокси-нода), а не всей цепочке XFF:
    // при trustProxy:true клиент мог бы сам подделать X-Forwarded-For и снова обойти throttle.
    // Если между клиентом и API появятся доп. прокси (LB/CDN), увеличить число хопов.
    trustProxy: 1,
  })

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  })

  // pino как логгер приложения (docs/BACKEND_RULES.md §13).
  app.useLogger(app.get(PinoLogger))

  // Возвращаем requestId клиенту для сквозной корреляции.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (req, reply, done) => {
      void reply.header('x-request-id', req.id)
      done()
    })

  const config: ConfigService<EnvVars, true> = app.get(ConfigService)

  const apiPrefix = config.get('API_PREFIX', { infer: true })
  app.setGlobalPrefix(apiPrefix)

  // §14.6 — helmet включён всегда.
  await app.register(helmet)

  // Чтение/установка cookie (refresh + role-cookie).
  await app.register(cookie)

  // §8 — приём multipart/form-data. Буферная загрузка через API ограничена порогом
  // (файлы больше грузятся напрямую в MinIO через presigned URL), чтобы не раздувать память процесса.
  await app.register(multipart, {
    limits: { fileSize: FILE_UPLOAD.DIRECT_UPLOAD_THRESHOLD_BYTES, files: 10 },
  })

  // §14.5 — CORS по whitelist, credentials. Явно перечисляем методы: без этого адаптер разрешал
  // только GET/HEAD/POST, и preflight блокировал DELETE/PATCH/PUT (открепление, удаление, mark-read).
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }).split(','),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })

  // §9 — WebSocket поверх socket.io на том же HTTP-сервере (RealtimeGateway).
  app.useWebSocketAdapter(new IoAdapter(app))

  app.enableShutdownHooks()

  // §12 — Swagger только в development, по пути /api/docs.
  if (config.get('NODE_ENV', { infer: true }) === 'development') {
    // TODO(Ф1): patchNestJsSwagger() для createZodDto-схем — включить после согласования
    // совместимых версий nestjs-zod ↔ @nestjs/swagger (в 4.3.1 патч ломается о swagger 11).
    const swaggerConfig = new DocumentBuilder()
      .setTitle('StudentHub API')
      .setDescription('Внутренний API образовательной платформы StudentHub')
      .setVersion('1.0')
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api/docs', app, document)
  }

  const port = config.get('PORT', { infer: true })
  // host '::' — dual-stack (IPv6 + IPv4). Прокси Railway (публичный edge и приватная
  // сеть *.railway.internal) ходит по IPv6; при '0.0.0.0' (только IPv4) он получает
  // TCP-reset → 502 «Application failed to respond». Локально '::' тоже принимает IPv4.
  await app.listen({ port, host: '::' })

  const bootstrapLogger = new Logger('Bootstrap')
  bootstrapLogger.log(`API слушает http://localhost:${port}/${apiPrefix}`)
  // Явно сообщаем режим наблюдаемости: молчащий Sentry из-за незаданного DSN — самая
  // частая причина «ошибки есть, а в трекере пусто».
  bootstrapLogger.log(
    sentryEnabled
      ? `Sentry включён (env=${config.get('SENTRY_ENVIRONMENT', { infer: true }) ?? config.get('NODE_ENV', { infer: true })})`
      : 'Sentry выключен: SENTRY_DSN не задан',
  )
}

void bootstrap()
