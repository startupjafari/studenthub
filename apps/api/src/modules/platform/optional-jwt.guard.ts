import { Injectable, type ExecutionContext } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { FastifyRequest } from 'fastify'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'

/**
 * Необязательная аутентификация для публичного `GET /platform/state`.
 *
 * Маршрут остаётся публичным (@Public): страница входа обязана узнать о техработах без
 * токена. Но ответ зависит от того, кто спрашивает, — адресный баннер, список вузов-
 * адресатов и настройки уведомлений команды анониму не положены (B-F19). Глобальный
 * JwtAuthGuard на публичном маршруте токен не читает вовсе, поэтому здесь он читается
 * отдельно — той же стратегией 'jwt', с теми же проверками подписи, срока, отзыва сессий
 * и блокировки вуза.
 *
 * Любой отказ — не ошибка, а аноним: просроченный или отозванный токен не должен ронять
 * ответ, который нужен как раз тем, кто не может войти. Без заголовка стратегию не зовём
 * совсем — у анонимного опроса раз в минуту не должно быть похода в Redis.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  override canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    if (!request.headers.authorization) return true
    return super.canActivate(context)
  }

  override handleRequest<TUser = CurrentUserData>(_err: unknown, user: TUser): TUser {
    // null, а не исключение: см. комментарий к классу.
    return (user || null) as TUser
  }
}
