import { Injectable } from '@nestjs/common'
import * as bcrypt from 'bcrypt'

// Хеширование паролей (docs/BACKEND_RULES.md §14.3, cost ≥ 10). Общий сервис,
// чтобы AuthModule и UsersModule не дублировали bcrypt и не создавали лишних связей.
const BCRYPT_ROUNDS = 12

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS)
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash)
  }
}
