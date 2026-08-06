import type { Params } from 'nestjs-pino'

// Конфиг pino (docs/BACKEND_RULES.md §13): редакция чувствительных полей,
// авто-логирование выключено — им занимается LoggingInterceptor.
// requestId (req.id) генерирует Fastify-адаптер (см. main.ts) и его же берёт pino.
const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const loggerConfig: Params = {
  pinoHttp: {
    level: isTest ? 'silent' : isProduction ? 'info' : 'debug',
    autoLogging: false,
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
