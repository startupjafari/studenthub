import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

// Триггерит LocalStrategy (email+пароль) для POST /auth/login.
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}
