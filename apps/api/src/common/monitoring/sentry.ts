import { HttpException } from '@nestjs/common'
import * as Sentry from '@sentry/nestjs'
import { scrubUrl } from '@studenthub/shared-config'

// Единственная точка отправки ошибок в Sentry (docs/BACKEND_RULES.md §13).
// Прямые вызовы Sentry.captureException в модулях запрещены: контекст должен быть
// однородным, иначе ошибки невозможно связать с логами pino по requestId.
//
// Если Sentry не инициализирован (нет SENTRY_DSN — dev, тесты, CI), вызовы ниже
// безопасные no-op'ы: SDK без init игнорирует captureException. Проверок на
// включённость в вызывающем коде быть не должно.

/** Откуда пришла ошибка. Уходит тегом `source` — по нему строятся алерты. */
export type ErrorSource = 'http' | 'queue' | 'ws' | 'cron'

export interface CaptureContext {
  source: ErrorSource
  /** Сквозной идентификатор запроса из pino (§13) — склейка Sentry ↔ логи. */
  requestId?: string
  /** Только opaque UUID пользователя. Email/ФИО отправлять запрещено (§11.3). */
  userId?: string
  /** Путь HTTP / имя job'а / имя WS-события. Секреты вычищаются. */
  path?: string
  method?: string
  /** Бизнес-код ошибки из контракта API (§4.2) — удобен для группировки. */
  code?: string
  /** Дополнительные НЕ персональные поля (id сущности, имя очереди, попытка). */
  extra?: Record<string, string | number | boolean | undefined>
}

/**
 * Отправляет исключение в Sentry с единым набором тегов.
 * Возвращает id события (или `undefined`, если трекер выключен) — его можно положить
 * в лог, чтобы из строки pino попасть в issue.
 */
export function captureException(exception: unknown, context: CaptureContext): string | undefined {
  return Sentry.withScope((scope) => {
    scope.setTag('source', context.source)
    if (context.code) {
      scope.setTag('error_code', context.code)
    }
    if (context.method) {
      scope.setTag('http_method', context.method)
    }
    if (context.requestId) {
      // Тег, а не extra: по requestId ищут конкретный запрос в поиске Sentry.
      scope.setTag('request_id', context.requestId)
    }
    if (context.path) {
      scope.setTag('path', scrubUrl(context.path))
    }
    if (context.userId) {
      // Псевдоним: только id. Без email/username — иначе персональные данные уедут
      // во внешний сервис (§11.3). Id достаточно, чтобы спросить у пользователя детали.
      scope.setUser({ id: context.userId })
    }
    for (const [key, value] of Object.entries(context.extra ?? {})) {
      if (value !== undefined) {
        scope.setExtra(key, value)
      }
    }
    return Sentry.captureException(exception, {
      mechanism: { handled: context.source !== 'http', type: context.source },
    })
  })
}

/**
 * Ожидаемый бизнес-отказ? `AppException`/`HttpException` со статусом < 500 — это
 * штатный отказ по правилам домена (нет прав, не найдено, конфликт), а не баг:
 * в трекер такое не отправляем, иначе issue-лента утонет в 403/404.
 */
export function isExpectedBusinessError(exception: unknown): boolean {
  return exception instanceof HttpException && exception.getStatus() < 500
}

/**
 * Захват для мест, где нет HTTP-статуса и решение «баг это или нет» принимаем сами:
 * обработчики WebSocket-событий и воркеры очередей. Ожидаемые бизнес-отказы пропускает.
 */
export function captureUnexpected(exception: unknown, context: CaptureContext): string | undefined {
  if (isExpectedBusinessError(exception)) {
    return undefined
  }
  return captureException(exception, context)
}
