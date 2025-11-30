import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidCredentialsException extends HttpException {
  constructor(message = 'Invalid email or password') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class EmailAlreadyExistsException extends HttpException {
  constructor(email: string) {
    super(`User with email ${email} already exists`, HttpStatus.CONFLICT);
  }
}

export class EmailNotVerifiedException extends HttpException {
  constructor(message = 'Email is not verified. Please verify your email first.') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class InvalidVerificationCodeException extends HttpException {
  constructor(message = 'Invalid or expired verification code') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TwoFactorRequiredException extends HttpException {
  constructor(message = 'Two-factor authentication is required') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTwoFactorCodeException extends HttpException {
  constructor(message = 'Invalid two-factor authentication code') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class TokenExpiredException extends HttpException {
  constructor(message = 'Token has expired') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class TokenBlacklistedException extends HttpException {
  constructor(message = 'Token has been revoked') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class InvalidTokenException extends HttpException {
  constructor(message = 'Invalid token') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class PasswordTooWeakException extends HttpException {
  constructor(message = 'Password is too weak') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class SamePasswordException extends HttpException {
  constructor(message = 'New password must be different from the current password') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class AccountLockedException extends HttpException {
  constructor(message = 'Account is locked due to multiple failed login attempts') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

