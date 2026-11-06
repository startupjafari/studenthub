import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Role, isRestrictedRole } from '@studenthub/shared-types'
import { AppException } from '../exceptions/app.exception'
import { RESTRICTED_ALLOWED_KEY } from '../decorators/restricted-allowed.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Запрет по умолчанию для ролей из RESTRICTED_ROLES (docs/PROJECT.md §2): охрана и
// библиотекарь ходят только на маршруты, где их роль названа в @RestrictedAllowed().
//
// Регистрируется APP_GUARD после JwtAuthGuard (нужен request.user) и до RolesGuard — как
// MiniAppGuard: отказ «этой роли сюда нельзя» не зависит от ролей маршрута.
//
// Остальных ролей guard не касается: решение за гардами ролей и scope, как раньше.
@Injectable()
export class RestrictedRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUserData }>()
    const role = request.user?.role
    if (!role || !isRestrictedRole(role)) return true

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(RESTRICTED_ALLOWED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (allowed?.includes(role)) return true

    throw new AppException('FORBIDDEN', 'Операция недоступна этой роли')
  }
}
