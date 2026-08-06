import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Извлекает валидированного пользователя из request (кладёт JwtStrategy).
// Роль и scope берутся только отсюда, не из body/query/header (§6.1).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: CurrentUserData }>()
    return request.user
  },
)
