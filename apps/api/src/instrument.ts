// Инициализация Sentry (Ф13.8). ЭТОТ ФАЙЛ ИМПОРТИРУЕТСЯ ПЕРВЫМ в main.ts и не должен
// импортировать ничего из приложения: Sentry.init обязан выполниться раньше, чем
// загрузятся инструментируемые библиотеки (http, fastify, pg/prisma, ioredis), иначе
// патчи OpenTelemetry не встанут и трассировка/контекст запроса потеряются.
//
// Env читается из process.env напрямую (ConfigModule ещё не существует). Значения
// объявлены и валидируются в src/config/env.schema.ts — приложение упадёт на старте,
// если DSN не URL или sample rate вне [0,1]; здесь дополнительно подстрахованы дефолты.
import * as Sentry from '@sentry/nestjs'
import { scrubEvent } from './common/monitoring/sentry-scrub'

const dsn = process.env.SENTRY_DSN

// Нет DSN — Sentry не инициализируется вообще. Это нормальный режим dev и тестов:
// весь код захвата ошибок ниже становится no-op'ом (Sentry.captureException без init
// ничего не делает и не бросает), поэтому условий `if (sentryEnabled)` в сервисах нет.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,

    // §14.9 / §11.3: не отправлять IP, cookie, заголовки авторизации и тела запросов.
    // Идентификатор пользователя прикладывается точечно и осознанно — только opaque UUID
    // (см. common/monitoring/sentry.ts), без email и ФИО.
    sendDefaultPii: false,

    // Трейсинг по умолчанию выключен (нужны ошибки, не профиль производительности).
    tracesSampleRate: clampRate(process.env.SENTRY_TRACES_SAMPLE_RATE),

    // Последняя чистка события перед отправкой; покрыта unit-тестами.
    beforeSend: scrubEvent,

    // Пути health-чека Railway/nginx создавали бы транзакцию на каждый пробник.
    ignoreTransactions: ['GET /api/v1/health', 'GET /health'],
  })
}

function clampRate(raw: string | undefined): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return Math.min(parsed, 1)
}

/** Инициализирован ли трекер (для /health и логов старта). */
export const sentryEnabled = Boolean(dsn)
