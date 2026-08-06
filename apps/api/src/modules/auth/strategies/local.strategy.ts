import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-local'
import { AuthService } from '../auth.service'
import type { JwtPayload } from '../../../common/auth/jwt-payload.type'

// Валидирует email+пароль при логине. usernameField переопределён на email.
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' })
  }

  validate(email: string, password: string): Promise<JwtPayload> {
    return this.authService.validateUser(email, password)
  }
}
