import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'
import { MINI_ALLOWED_KEY } from '../decorators/mini-allowed.decorator'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Ограничение токена админского мини-аппа (docs/PROJECT.md §8.3).
//
// Токен из Telegram несёт `client: 'mini'` и пускает ТОЛЬКО на маршруты с @MiniAllowed().
// Всё остальное — 403, даже если роль пользователя в вебе это позволяет: телефон теряют,
// а платформенный администратор может в вебе почти всё.
//
// Регистрируется APP_GUARD после JwtAuthGuard (нужен request.user) и до RolesGuard: отказ
// «не с этого клиента» дешевле и понятнее, чем отказ по роли на маршруте, куда мини-аппу
// нельзя в принципе.
//
// Обычных токенов guard не касается вовсе: нет `client` — решение принимают гарды ролей
// и scope, как раньше.
@Injectable()
export class MiniAppGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: CurrentUserData }>()
    const user = request.user
    if (user?.client !== 'mini') return true

    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(MINI_ALLOWED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (allowed) return true

    throw new AppException('FORBIDDEN', 'Операция недоступна из мини-аппа')
  }
}
