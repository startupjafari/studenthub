import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SKIP_EMAIL_VERIFICATION_KEY,
} from '../../../common/decorators/skip-email-verification.decorator';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route skips email verification
    const skipVerification = this.reflector.getAllAndOverride<boolean>(
      SKIP_EMAIL_VERIFICATION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipVerification) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Требуется подтверждение email. Пожалуйста, подтвердите ваш email адрес.',
      );
    }

    return true;
  }
}

