import { HttpException } from '@nestjs/common'
import { ERROR_CODE_STATUS, type ErrorCode, type ErrorDetail } from '@studenthub/shared-types'

// Бизнес-исключение с явным кодом из реестра (docs/BACKEND_RULES.md §4.3/§4.4).
// Сервисы бросают его, когда нужен конкретный code (WRONG_SCOPE, INVITE_USED, TOKEN_EXPIRED и т.п.).
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    status?: number,
  ) {
    super(message, status ?? ERROR_CODE_STATUS[code])
  }
}
