import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../protocol/constants/error-codes.constant';

export class InvalidCredentialsException extends HttpException {
  constructor(message = 'Неверный email или пароль') {
    super(
      {
        code: ErrorCode.AUTH_INVALID_CREDENTIALS,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class EmailAlreadyExistsException extends HttpException {
  constructor(email: string) {
    super(
      {
        code: ErrorCode.RESOURCE_ALREADY_EXISTS,
        message: `Пользователь с email ${email} уже существует`,
        statusCode: HttpStatus.CONFLICT,
        details: { email },
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class EmailNotVerifiedException extends HttpException {
  constructor(message = 'Email не подтвержден. Пожалуйста, сначала подтвердите ваш email.') {
    super(
      {
        code: ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        message,
        statusCode: HttpStatus.FORBIDDEN,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export class InvalidVerificationCodeException extends HttpException {
  constructor(message = 'Неверный или истекший код подтверждения') {
    super(
      {
        code: ErrorCode.VALIDATION_INVALID_VERIFICATION_CODE,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class TwoFactorRequiredException extends HttpException {
  constructor(message = 'Требуется двухфакторная аутентификация') {
    super(
      {
        code: ErrorCode.AUTH_TWO_FACTOR_REQUIRED,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class InvalidTwoFactorCodeException extends HttpException {
  constructor(message = 'Неверный код двухфакторной аутентификации') {
    super(
      {
        code: ErrorCode.AUTH_TWO_FACTOR_INVALID,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class TokenExpiredException extends HttpException {
  constructor(message = 'Токен истек') {
    super(
      {
        code: ErrorCode.AUTH_TOKEN_EXPIRED,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class TokenBlacklistedException extends HttpException {
  constructor(message = 'Токен был отозван') {
    super(
      {
        code: ErrorCode.AUTH_TOKEN_BLACKLISTED,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class InvalidTokenException extends HttpException {
  constructor(message = 'Неверный токен') {
    super(
      {
        code: ErrorCode.AUTH_INVALID_TOKEN,
        message,
        statusCode: HttpStatus.UNAUTHORIZED,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class PasswordTooWeakException extends HttpException {
  constructor(message = 'Пароль слишком слабый') {
    super(
      {
        code: ErrorCode.AUTH_PASSWORD_TOO_WEAK,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class SamePasswordException extends HttpException {
  constructor(message = 'Новый пароль должен отличаться от текущего пароля') {
    super(
      {
        code: ErrorCode.AUTH_SAME_PASSWORD,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class AccountLockedException extends HttpException {
  constructor(message = 'Аккаунт заблокирован из-за множественных неудачных попыток входа') {
    super(
      {
        code: ErrorCode.AUTH_ACCOUNT_LOCKED,
        message,
        statusCode: HttpStatus.FORBIDDEN,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export class TwoFactorAlreadyEnabledException extends HttpException {
  constructor(message = '2FA уже включена') {
    super(
      {
        code: ErrorCode.AUTH_TWO_FACTOR_ALREADY_ENABLED,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class TwoFactorNotEnabledException extends HttpException {
  constructor(message = '2FA не включена') {
    super(
      {
        code: ErrorCode.AUTH_TWO_FACTOR_NOT_ENABLED,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class TwoFactorSetupExpiredException extends HttpException {
  constructor(message = 'Сессия настройки 2FA истекла. Пожалуйста, сгенерируйте новый QR-код.') {
    super(
      {
        code: ErrorCode.AUTH_TWO_FACTOR_SETUP_EXPIRED,
        message,
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

