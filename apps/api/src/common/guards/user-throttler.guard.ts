import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectThrottlerOptions, InjectThrottlerStorage, ThrottlerGuard } from '@nestjs/throttler'
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler'
import { Reflector } from '@nestjs/core'
import type { EnvVars } from '../../config/env.schema'

/**
 * Лимиты по пользователю, а не по IP (docs/BACKEND_RULES.md §6.3: «100/мин с пользователя»).
 *
 * Штатный трекер — `req.ip`. Вуз за NAT делит один адрес на весь кампус: сотня студентов на
 * одном маршруте упиралась в 429 вместе, а «пользовательский» лимит обходился сменой IP.
 *
 * `request.user` здесь ещё не заполнен: глобальные guard'ы AppModule идут раньше
 * JwtAuthGuard из AuthModule. Поэтому токен проверяется тут же — подписью, а не простым
 * разбором: иначе поддельный `sub` в Bearer давал бы каждому запросу свежий счётчик и
 * снимал лимиты с публичных маршрутов (вход, сброс пароля). Без валидного токена —
 * прежний счёт по IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private readonly jwt: JwtService

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService<EnvVars, true>,
  ) {
    super(options, storage, reflector)
    this.jwt = new JwtService({ secret: config.get('JWT_ACCESS_SECRET', { infer: true }) })
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const sub = this.verifiedSubject(req)
    return sub ? `user:${sub}` : String(req.ip ?? '')
  }

  private verifiedSubject(req: Record<string, unknown>): string | null {
    const headers = req.headers as Record<string, string | undefined> | undefined
    const header = headers?.authorization
    if (!header?.startsWith('Bearer ')) return null
    try {
      const payload = this.jwt.verify<{ sub?: string; typ?: string }>(header.slice(7))
      // Промежуточный токен 2FA — не сессия: его владелец ещё не вошёл.
      return payload.typ ? null : (payload.sub ?? null)
    } catch {
      return null
    }
  }
}
