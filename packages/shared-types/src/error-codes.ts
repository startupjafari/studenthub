// Реестр кодов ошибок — публичный контракт API (docs/PROJECT.md §8.2, docs/BACKEND_RULES.md §4.3).
// Клиент реагирует на `code`, не на `message`. Новый код добавляется сюда И в docs/PROJECT.md.

export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  WRONG_SCOPE: 'WRONG_SCOPE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_USED: 'INVITE_USED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_DIRECT_UPLOAD_REQUIRED: 'FILE_DIRECT_UPLOAD_REQUIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMIT: 'RATE_LIMIT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** HTTP-статус по умолчанию для каждого кода. */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  WRONG_SCOPE: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVITE_EXPIRED: 410,
  INVITE_USED: 410,
  INVITE_REVOKED: 410,
  // 415 Unsupported Media Type — тип не в белом списке (проверка по magic bytes).
  FILE_TYPE_NOT_ALLOWED: 415,
  // 413 Payload Too Large — размер больше лимита категории.
  FILE_TOO_LARGE: 413,
  // 413 — файл в пределах лимита категории, но больше порога буферной загрузки:
  // такой грузится только напрямую в MinIO через presigned URL, минуя API-процесс (§8).
  FILE_DIRECT_UPLOAD_REQUIRED: 413,
  VALIDATION_ERROR: 422,
  RATE_LIMIT: 429,
  INTERNAL_ERROR: 500,
}

/** Код по умолчанию для HTTP-статуса (для стандартных Nest-исключений без явного кода). */
export function errorCodeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST
    case 401:
      return ErrorCode.UNAUTHORIZED
    case 403:
      return ErrorCode.FORBIDDEN
    case 404:
      return ErrorCode.NOT_FOUND
    case 409:
      return ErrorCode.CONFLICT
    case 422:
      return ErrorCode.VALIDATION_ERROR
    case 429:
      return ErrorCode.RATE_LIMIT
    default:
      return ErrorCode.INTERNAL_ERROR
  }
}
