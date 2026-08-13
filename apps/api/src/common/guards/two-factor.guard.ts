import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@studenthub/shared-types'
import { AppException } from '../exceptions/app.exception'
import { TWO_FACTOR_EXEMPT } from '../decorators/two-factor-exempt.decorator'
import type { JwtPayload } from '../auth/jwt-payload.type'

// Роли, которым 2FA ОБЯЗАТЕЛЬНА (привилегированные: платформа, админ/модератор вуза, декан).
// Скомпрометированный пароль такой учётки открывает доступ к чужим данным целого вуза/факультета,
// поэтому второй фактор форсим. Студент/староста/преподаватель — по желанию.
export const TWO_FACTOR_REQUIRED_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.PLATFORM_MODERATOR,
  Role.UNIVERSITY_ADMIN,
  Role.UNIVERSITY_MODERATOR,
  Role.DEAN,
]

/**
 * Форс 2FA: привилегированная роль без включённой 2FA получает 403 TWO_FACTOR_SETUP_REQUIRED
 * на все эндпоинты, кроме помеченных @TwoFactorExempt() (настройка/включение 2FA). Флаг `tfa`
 * читается из JWT (без БД); после включения 2FA следующая ротация токена (refresh) снимет блок.
 * Регистрируется APP_GUARD ПОСЛЕ JwtAuthGuard (нужен request.user).
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean>(TWO_FACTOR_EXEMPT, [
      context.getHandler(),
      context.getClass(),
    ])
    if (exempt) return true

    const req = context.switchToHttp().getRequest<{ user?: JwtPayload }>()
    const user = req?.user
    if (!user) return true // публичные роуты (нет пользователя) — не наша забота
    if (!TWO_FACTOR_REQUIRED_ROLES.includes(user.role)) return true
    if (user.tfa === true) return true

    throw new AppException(
      'TWO_FACTOR_SETUP_REQUIRED',
      'Для этой роли необходимо включить двухфакторную аутентификацию',
    )
  }
}
