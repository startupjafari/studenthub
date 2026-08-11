import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-local'
import { AuthService } from '../auth.service'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'

// Валидирует идентификатор (email ИЛИ username) + пароль при логине. Поле — `identifier`.
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'identifier' })
  }

  validate(identifier: string, password: string): Promise<JwtPayload> {
    return this.authService.validateUser(identifier, password)
  }
}
