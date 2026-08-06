import { Injectable } from '@nestjs/common'
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
  validate(payload: JwtPayload): JwtPayload {
    return {
      sub: payload.sub,
      role: payload.role,
      universityId: payload.universityId ?? null,
      facultyId: payload.facultyId ?? null,
      groupId: payload.groupId ?? null,
    }
  }
}
