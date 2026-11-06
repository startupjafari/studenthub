import type { captureException as sentryCaptureException } from '@sentry/nextjs'
import { sentryEnabled } from './sentry-options'

/**
 * `Sentry.captureException` без статического импорта SDK (задача 21.B4).
 *
 * Экран ошибки стоит в корне каждой страницы, и статический импорт клал ~90 КБ SDK в бандл
 * любой страницы — даже без DSN, когда трекер выключен и отправлять нечего. Теперь SDK
 * приезжает отдельным чанком и только при включённом трекере.
 */
export function captureException(...args: Parameters<typeof sentryCaptureException>): void {
  if (!sentryEnabled) return
  void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(...args))
}
