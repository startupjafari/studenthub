import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidCredentialsException extends HttpException {
  constructor(message = 'Неверный email или пароль') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class EmailAlreadyExistsException extends HttpException {
  constructor(email: string) {
    super(`Пользователь с email ${email} уже существует`, HttpStatus.CONFLICT);
  }
}

export class EmailNotVerifiedException extends HttpException {
  constructor(message = 'Email не подтвержден. Пожалуйста, сначала подтвердите ваш email.') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class InvalidVerificationCodeException extends HttpException {
  constructor(message = 'Неверный или истекший код подтверждения') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TwoFactorRequiredException extends HttpException {
  constructor(message = 'Требуется двухфакторная аутентификация') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTwoFactorCodeException extends HttpException {
  constructor(message = 'Неверный код двухфакторной аутентификации') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TokenExpiredException extends HttpException {
  constructor(message = 'Токен истек') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class TokenBlacklistedException extends HttpException {
  constructor(message = 'Токен был отозван') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTokenException extends HttpException {
  constructor(message = 'Неверный токен') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class PasswordTooWeakException extends HttpException {
  constructor(message = 'Пароль слишком слабый') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class SamePasswordException extends HttpException {
  constructor(message = 'Новый пароль должен отличаться от текущего пароля') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class AccountLockedException extends HttpException {
  constructor(message = 'Аккаунт заблокирован из-за множественных неудачных попыток входа') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class TwoFactorAlreadyEnabledException extends HttpException {
  constructor(message = '2FA уже включена') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TwoFactorNotEnabledException extends HttpException {
  constructor(message = '2FA не включена') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TwoFactorSetupExpiredException extends HttpException {
  constructor(message = 'Сессия настройки 2FA истекла. Пожалуйста, сгенерируйте новый QR-код.') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

