import type { ConfigService } from '@nestjs/config'
import type { EnvVars } from '../../config/env.schema'

/**
 * Постоянный публичный URL объекта в ПУБЛИЧНОМ бакете (avatars, profile-media, covers).
 *
 * Если задан MINIO_PUBLIC_ENDPOINT (прод: домен MinIO, который резолвит браузер) —
 * URL строится на него; иначе — на внутренний MINIO_ENDPOINT (dev без изменений).
 * Это та же логика, что у MINIO_PUBLIC_CLIENT для presigned-ссылок (minio.module.ts):
 * приватный minio.railway.internal браузер не резолвит → ERR_NAME_NOT_RESOLVED.
 *
 * Дефолтный для схемы порт (443/https, 80/http) в URL опускается.
 *
 * ВНИМАНИЕ: только для публичных бакетов. Для приватных постоянный публичный URL
 * запрещён (docs/BACKEND_RULES.md §8) — там presigned через FileService.
 */
export function buildPublicObjectUrl(
  config: ConfigService<EnvVars, true>,
  bucket: string,
  key: string,
): string {
  const publicEndpoint = config.get('MINIO_PUBLIC_ENDPOINT', { infer: true })
  const endpoint = publicEndpoint ?? config.get('MINIO_ENDPOINT', { infer: true })
  const useSSL = publicEndpoint
    ? config.get('MINIO_PUBLIC_USE_SSL', { infer: true })
    : config.get('MINIO_USE_SSL', { infer: true })
  const port = publicEndpoint
    ? config.get('MINIO_PUBLIC_PORT', { infer: true })
    : config.get('MINIO_PORT', { infer: true })

  const scheme = useSSL ? 'https' : 'http'
  const isDefaultPort = (useSSL && port === 443) || (!useSSL && port === 80)
  const authority = isDefaultPort ? endpoint : `${endpoint}:${port}`
  return `${scheme}://${authority}/${bucket}/${key}`
}
