import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Второй барьер (§6.1): проверяет роль из токена против @Roles(...).
// Эндпоинт без @Roles() доступен любому аутентифицированному.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: CurrentUserData }>()
    const user = request.user
    if (!user) {
      throw new AppException('UNAUTHORIZED', 'Требуется авторизация')
    }
    if (!required.includes(user.role)) {
      throw new AppException('FORBIDDEN', 'Недостаточно прав для этого действия')
    }
    return true
  }
}
