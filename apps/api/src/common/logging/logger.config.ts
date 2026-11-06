import type { Params } from 'nestjs-pino'
import { scrubHeaders, scrubUrl } from '@studenthub/shared-config'

// Конфиг pino (docs/BACKEND_RULES.md §13): редакция чувствительных полей,
// авто-логирование выключено — строку на запрос пишет access-лог (logging/access-log.ts).
// requestId (req.id) генерирует Fastify-адаптер (см. main.ts) и его же берёт pino.
const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

/** Запрос после стандартного сериализатора pino — поля, которые оставляем в логе. */
interface SerializedRequest {
  id?: unknown
  method?: string
  url?: string
  headers?: Record<string, unknown>
  remoteAddress?: string
  remotePort?: number
}

/**
 * Запрос в каждой строке лога (pino-http кладёт его в child-логгер запроса). Стандартный
 * сериализатор писал сырой адрес и все заголовки: токен инвайта из
 * `/invites/<token>/preview`, HLS-токен `?t=`, секрет вебхука Telegram. Адрес чистит тот
 * же `scrubUrl`, что и Sentry; `query`/`params` не пишем вовсе — в них те же значения.
 */
export function serializeRequest(req: SerializedRequest): Record<string, unknown> {
  return {
    id: req.id,
    method: req.method,
    url: typeof req.url === 'string' ? scrubUrl(req.url) : undefined,
    headers: scrubHeaders(req.headers),
    remoteAddress: req.remoteAddress,
    remotePort: req.remotePort,
  }
}

export const loggerConfig: Params = {
  pinoHttp: {
    level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
    autoLogging: false,
    serializers: { req: serializeRequest },
    // Никогда не логируем секреты и персональные данные (§13).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.token',
      ],
      remove: true,
    },
    transport:
      isProduction || isTest
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
  },
}
