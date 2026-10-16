import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { EnvVars } from '../../../config/env.schema'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'
import { SessionRevocationService } from '../../../common/redis/session-revocation.service'
import { UniversityAccessService } from '../../universities/university-access.service'

// Валидирует access-токен из Authorization: Bearer. Payload → request.user.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name)

  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly revocation: SessionRevocationService,
    private readonly universityAccess: UniversityAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    })
  }

  // passport-jwt уже проверил подпись и срок; возвращаем payload как есть.
  async validate(payload: JwtPayload & { typ?: string; iat?: number }): Promise<JwtPayload> {
    // Промежуточный challenge-токен 2FA (typ='TWO_FACTOR') подписан тем же секретом,
    // но НЕ является access-токеном — отвергаем, чтобы им нельзя было авторизоваться.
    if (payload.typ) {
      throw new UnauthorizedException('Недопустимый токен')
    }
    // Сессии пользователя отозваны (блокировка, удаление, смена пароля) после выдачи токена.
    if (await this.revocation.isRevoked(payload.sub, payload.iat)) {
      throw new UnauthorizedException('Сессия отозвана')
    }
    // Вуз заблокирован платформой после выдачи токена: без этой проверки его пользователи
    // работали бы до истечения access-токена. Код отказа (UNIVERSITY_BLOCKED) JwtAuthGuard
    // отдаёт клиенту как есть.
    const denial = await this.universityDenial(payload)
    if (denial) {
      throw denial
    }
    // Белый список полей: в request.user попадает только то, что перечислено здесь, —
    // посторонние claim'ы из подписанного токена внутрь приложения не проходят.
    // Обратная сторона: КАЖДОЕ новое поле JwtPayload нужно добавить и сюда, иначе оно
    // молча теряется. Ровно так пропал companyId (Ф18): токен его нёс, а работодатель
    // получал «аккаунт не привязан к компании» на всех экранах.
    return {
      sub: payload.sub,
      role: payload.role,
      universityId: payload.universityId ?? null,
      facultyId: payload.facultyId ?? null,
      groupId: payload.groupId ?? null,
      companyId: payload.companyId ?? null,
      tfa: payload.tfa ?? false,
      ...(payload.client ? { client: payload.client } : {}),
    }
  }

  // Сбой чтения статуса запрос не роняет: проверка стоит на каждом запросе, и отказ базы
  // здесь превратился бы в 500 на всём API. Вход и refresh статус проверяют сами.
  private async universityDenial(payload: JwtPayload) {
    try {
      return await this.universityAccess.denial(payload)
    } catch (error) {
      this.logger.warn({ err: error }, 'Статус вуза не прочитан — допуск по токену без проверки')
      return null
    }
  }
}
