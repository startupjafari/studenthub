import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from './env.schema'

/**
 * Публичный адрес веб-приложения — для ссылок, которые уходят наружу (QR студенческого,
 * QR помещения, письма). Берётся из первого origin в `CORS_ORIGIN`: отдельной переменной
 * для этого нет, а в проде CORS_ORIGIN всегда указывает на web (docs/RAILWAY.md §2).
 */
export function webBaseUrl(config: ConfigService<EnvVars, true>): string {
  return pickWebBase(config.get('CORS_ORIGIN', { infer: true }))
}

/**
 * То же правило без DI — для шаблонов писем: они чистые функции рендера и ConfigService
 * не получают, но адрес в подвале обязан совпадать с адресом в ссылках.
 */
export function pickWebBase(raw: string): string {
  return raw.split(',')[0]?.trim() ?? ''
}
