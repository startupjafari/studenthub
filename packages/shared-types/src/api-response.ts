// Единый конверт ответа API (docs/PROJECT.md §8.1, docs/BACKEND_RULES.md §4).
// Используется и бэкендом (ResponseInterceptor/HttpExceptionFilter), и фронтом (типизация axios).

import type { ErrorCode } from './error-codes.js'

export interface ApiMeta {
  cursor?: string
  hasNext?: boolean
  total?: number
}

export interface ApiSuccessResponse<T> {
  success: true
  data: T
  meta?: ApiMeta
}

export interface ErrorDetail {
  field: string
  message: string
}

export interface ApiErrorBody {
  code: ErrorCode
  message: string
  details?: ErrorDetail[]
}

export interface ApiErrorResponse {
  success: false
  error: ApiErrorBody
  statusCode: number
  timestamp: string
  path: string
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse
