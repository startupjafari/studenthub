import { applyDecorators, Injectable, SetMetadata } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  Throttle,
  ThrottlerGuard,
} from '@nestjs/throttler'
import type { ThrottlerModuleOptions, ThrottlerRequest, ThrottlerStorage } from '@nestjs/throttler'
import { Reflector } from '@nestjs/core'
import { createHash } from 'node:crypto'
import type { EnvVars } from '../../config/env.schema'
import { REFRESH_COOKIE } from '../../modules/auth/auth.constants'

/** Окно лимита: столько запросов за `ttl` миллисекунд. */
export interface ThrottleWindow {
  limit: number
  ttl: number
}

/**
 * Чем опознаётся клиент публичного auth-маршрута вместо адреса, общего на весь кампус:
 * - `refresh` — id refresh-токена из cookie (часть до точки);
 * - `invite-body` / `invite-param` — хэш токена инвайта из тела / из пути;
 * - `login` — адрес + идентификатор входа (email или username, без учёта регистра);
 * - `login-2fa` — адрес + владелец проверенного challenge-токена.
 */
export type AuthThrottleKey = 'refresh' | 'invite-body' | 'invite-param' | 'login' | 'login-2fa'

interface AuthThrottlePolicy {
  key: AuthThrottleKey
  ipCeiling: ThrottleWindow
}

const AUTH_THROTTLE_POLICY = 'studenthub:auth-throttle-policy'

/**
 * Лимит публичного auth-маршрута (docs/BACKEND_RULES.md §6.3): свой счётчик у каждого клиента
 * (`own`, ключ — по `key`) и мягкий общий потолок с адреса (`ipCeiling`).
 *
 * Почему не по IP: вуз за NAT делит один адрес на весь кампус. Тридцать студентов,
 * регистрирующихся на паре по инвайтам, упирались в «3 в час с IP», а refresh всех вкладок
 * кампуса — в общие 100 в минуту, после чего клиент считал сессию мёртвой. Перебор при этом
 * сдерживают другие вещи: счётчик неудач по учётке (LOGIN_LOCKED), попытки на challenge 2FA,
 * 122 бита случайности у токенов инвайта и refresh. Потолок с адреса остаётся — против
 * перебора с подменой ключа (каждый новый идентификатор или токен дал бы свежий счётчик).
 *
 * Нет материала для ключа (cookie нет, токен не строка, challenge поддельный) — считается
 * только потолок с адреса: такой запрос дальше всё равно отклоняется без дорогой работы.
 */
export const AuthThrottle = (
  key: AuthThrottleKey,
  own: ThrottleWindow,
  ipCeiling: ThrottleWindow,
) =>
  applyDecorators(
    Throttle({ default: own }),
    SetMetadata(AUTH_THROTTLE_POLICY, { key, ipCeiling } satisfies AuthThrottlePolicy),
  )

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
 * прежний счёт по IP. Публичные auth-маршруты с `@AuthThrottle` считаются по своему ключу
 * и потолку с адреса — см. сам декоратор.
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

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const policy = this.reflector.get<AuthThrottlePolicy | undefined>(
      AUTH_THROTTLE_POLICY,
      props.context.getHandler(),
    )
    if (!policy) return super.handleRequest(props)

    const { req } = this.getRequestResponse(props.context)
    const ip = String(req.ip ?? '')
    // Сначала свой счётчик: упёршийся в него клиент получает 429 и не тратит общий потолок
    // соседей по адресу.
    const own = this.authTracker(policy.key, req, ip)
    if (own) await super.handleRequest({ ...props, getTracker: () => own })
    const { limit, ttl } = policy.ipCeiling
    return super.handleRequest({
      ...props,
      limit,
      ttl,
      blockDuration: ttl,
      getTracker: () => `ip-ceiling:${ip}`,
    })
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const sub = this.verifiedSubject(req)
    return sub ? `user:${sub}` : String(req.ip ?? '')
  }

  private authTracker(
    key: AuthThrottleKey,
    req: Record<string, unknown>,
    ip: string,
  ): string | null {
    const body = (req.body ?? {}) as Record<string, unknown>
    switch (key) {
      case 'refresh': {
        const cookies = req.cookies as Record<string, string | undefined> | undefined
        const raw = cookies?.[REFRESH_COOKIE]
        const dot = raw?.indexOf('.') ?? -1
        // id записи refresh-токена, а не весь токен: секрет в ключи счётчиков не попадает.
        return raw && dot > 0 ? `refresh:${raw.slice(0, dot)}` : null
      }
      case 'invite-body':
        return inviteTracker(body.token)
      case 'invite-param':
        return inviteTracker((req.params as Record<string, unknown> | undefined)?.token)
      case 'login': {
        const identifier = body.identifier
        if (typeof identifier !== 'string' || !identifier.trim()) return null
        return `login:${ip}:${digest(identifier.trim().toLowerCase())}`
      }
      case 'login-2fa': {
        const sub = this.challengeSubject(body.challengeToken)
        return sub ? `login-2fa:${ip}:${sub}` : null
      }
    }
  }

  // Владелец challenge-токена второго шага входа — только по проверенной подписи: иначе
  // поддельный `sub` давал бы каждой попытке свежий счётчик.
  private challengeSubject(token: unknown): string | null {
    if (typeof token !== 'string' || !token) return null
    try {
      const payload = this.jwt.verify<{ sub?: string; typ?: string }>(token)
      return payload.typ === 'TWO_FACTOR' ? (payload.sub ?? null) : null
    } catch {
      return null
    }
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

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

// Хэш, а не сам токен инвайта: по ключу счётчика зарегистрироваться не должно получиться.
function inviteTracker(token: unknown): string | null {
  return typeof token === 'string' && token ? `invite:${digest(token)}` : null
}
