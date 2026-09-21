import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'
import { AppException } from '../exceptions/app.exception'
import {
  REQUIRES_CONFIRMATION_KEY,
  type ConfirmationRule,
} from '../decorators/requires-confirmation.decorator'
import { ACTION_CONFIRMATION, type ActionConfirmation } from '../auth/confirmation.constants'
import type { CurrentUserData } from '../auth/jwt-payload.type'

// Подтверждение разрушительного действия вторым фактором (docs/PROJECT.md §Мини-апп).
//
// Guard, а не проверка в сервисе: требование ставится декоратором на маршрут, и ни
// ComplaintsService, ни UserService не узнают о существовании TwoFactorService. Это не
// вкусовщина — домены `auth` и `users` уже замкнуты друг на друга через forwardRef, и
// каждый новый импорт в это кольцо однажды уронил запуск приложения при зелёных тестах.
//
// Срабатывает ТОЛЬКО для токена мини-аппа: в вебе человек прошёл пароль и 2FA в этой же
// сессии, а телефон открывается одним касанием.
@Injectable()
export class ActionConfirmGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // По токену, а не по классу: прямой импорт TwoFactorService замыкает кольцо
    // импортов домена auth и валит запуск (см. confirmation.constants.ts).
    @Inject(ACTION_CONFIRMATION) private readonly twoFactor: ActionConfirmation,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true

    const rule = this.reflector.getAllAndOverride<ConfirmationRule | undefined>(
      REQUIRES_CONFIRMATION_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (!rule) return true

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: CurrentUserData; body?: Record<string, unknown> }>()
    if (request.user?.client !== 'mini') return true

    // Предикат смотрит на тело: разрушительно не всякое обращение к маршруту.
    if (rule !== true && !rule(request.body ?? {})) return true

    const code = typeof request.body?.code === 'string' ? request.body.code : null
    const ok = code ? await this.twoFactor.verifyForUser(request.user.sub, code) : false
    if (!ok) throw new AppException('INVALID_2FA_CODE', 'Неверный код подтверждения')
    return true
  }
}
