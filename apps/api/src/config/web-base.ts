import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from './env.schema'

/**
 * Публичный адрес веб-приложения — для ссылок, которые уходят наружу (QR студенческого,
 * QR помещения, письма). Берётся из первого origin в `CORS_ORIGIN`: отдельной переменной
 * для этого нет, а в проде CORS_ORIGIN всегда указывает на web (docs/RAILWAY.md §2).
 */
export function webBaseUrl(config: ConfigService<EnvVars, true>): string {
  return config.get('CORS_ORIGIN', { infer: true }).split(',')[0]?.trim() ?? ''
}
