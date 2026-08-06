import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'
import { SCOPE_KEY, type ScopeConfig } from '../decorators/scope.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Третий барьер (§6.1): scope ресурса должен совпадать со scope из токена.
// Платформенные роли имеют глобальный доступ. Guard НЕ заменяет проверку в сервисе —
// сервис дополнительно сверяет фактическую принадлежность ресурса.
@Injectable()
export class ScopeGuard implements CanActivate {
  private static readonly GLOBAL_ROLES: readonly Role[] = [
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
  ]

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.getAllAndOverride<ScopeConfig | undefined>(SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!config) {
      return true
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: CurrentUserData }>()
    const user = request.user
    if (!user) {
      throw new AppException('UNAUTHORIZED', 'Требуется авторизация')
    }

    // Платформенные роли — глобальный scope.
    if (ScopeGuard.GLOBAL_ROLES.includes(user.role)) {
      return true
    }

    const claimKey = `${config.level}Id` as const
    const userScope = user[claimKey]
    if (!userScope) {
      throw new AppException('WRONG_SCOPE', 'Нет доступа к этой области данных')
    }

    const source = config.source ?? 'params'
    const paramName = config.param ?? claimKey
    const container = request[source] as Record<string, unknown> | undefined
    const resourceScope = container?.[paramName]

    // Если идентификатор ресурса присутствует в запросе — он обязан совпасть со scope пользователя.
    if (resourceScope !== undefined && resourceScope !== userScope) {
      throw new AppException('WRONG_SCOPE', 'Ресурс другого университета/факультета/группы')
    }
    return true
  }
}
