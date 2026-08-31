import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import type { EnvVars } from '../../../config/env.schema'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'

// Валидирует access-токен из Authorization: Bearer. Payload → request.user.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<EnvVars, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    })
  }

  // passport-jwt уже проверил подпись и срок; возвращаем payload как есть.
  validate(payload: JwtPayload & { typ?: string }): JwtPayload {
    // Промежуточный challenge-токен 2FA (typ='TWO_FACTOR') подписан тем же секретом,
    // но НЕ является access-токеном — отвергаем, чтобы им нельзя было авторизоваться.
    if (payload.typ) {
      throw new UnauthorizedException('Недопустимый токен')
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
    }
  }
}
