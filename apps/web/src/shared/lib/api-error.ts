import type { ApiErrorBody, ErrorCode } from '@studenthub/shared-types'

// Интерцептор (shared/api/instance.ts) отклоняет промис телом ошибки { code, message, details? }.
// Здесь приводим любое пойманное значение к этому контракту, чтобы UI работал с code, а не с текстом.
export function toApiError(error: unknown): ApiErrorBody {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const e = error as { code: unknown; message?: unknown; details?: ApiErrorBody['details'] }
    if (typeof e.code === 'string') {
      return {
        code: e.code as ErrorCode,
        message: typeof e.message === 'string' ? e.message : '',
        ...(Array.isArray(e.details) ? { details: e.details } : {}),
      }
    }
  }
  return { code: 'INTERNAL_ERROR', message: '' }
}
