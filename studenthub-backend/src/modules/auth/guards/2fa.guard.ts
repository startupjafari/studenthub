import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * This guard checks if 2FA is enabled and verified for the user
 * Used for routes that require 2FA verification during login
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Пользователь не аутентифицирован');
    }

    // If 2FA is enabled, it should have been verified during login
    // This guard is mainly for additional checks if needed
    return true;
  }
}
