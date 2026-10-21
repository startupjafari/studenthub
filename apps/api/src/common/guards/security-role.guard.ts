import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import { AppException } from '../exceptions/app.exception'
import { SECURITY_ALLOWED_KEY } from '../decorators/security-allowed.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Ограничение роли охранника (docs/PROJECT.md §2): только маршруты с @SecurityAllowed().
//
// Регистрируется APP_GUARD после JwtAuthGuard (нужен request.user) и до RolesGuard — как
// MiniAppGuard: отказ «охране сюда нельзя» не зависит от ролей маршрута.
//
// Остальных ролей guard не касается: решение за гардами ролей и scope, как раньше.
@Injectable()
export class SecurityRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUserData }>()
    if (request.user?.role !== Role.SECURITY_GUARD) return true

    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(SECURITY_ALLOWED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (allowed) return true

    throw new AppException('FORBIDDEN', 'Операция недоступна охране')
  }
}
