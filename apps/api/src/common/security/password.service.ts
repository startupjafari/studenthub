import { Injectable } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import * as bcrypt from 'bcrypt'

// Хеширование паролей (docs/BACKEND_RULES.md §14.3, cost ≥ 10). Общий сервис,
// чтобы AuthModule и UsersModule не дублировали bcrypt и не создавали лишних связей.
const BCRYPT_ROUNDS = 12

@Injectable()
export class PasswordService {
  /** Хэш-пустышка для сравнения «вхолостую». Считается лениво, один раз на процесс. */
  private dummyHash: Promise<string> | null = null

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS)
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash)
  }

  /**
   * Сравнение с заведомо не подходящим хэшем: всегда false, но по времени неотличимо
   * от настоящей проверки.
   *
   * Нужно там, где пользователь не найден. Без этого bcrypt (cost 12, ~250 мс) просто не
   * выполняется, ответ приходит заметно быстрее — и по времени ответа перебирается,
   * какие адреса и логины на платформе существуют. Для закрытой платформы это готовый
   * список целей для фишинга и подбора пароля.
   *
   * Хэш случайный: подобрать к нему пароль нельзя, а знать его содержимое незачем.
   */
  async compareWithDummy(plain: string): Promise<false> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'))
    await bcrypt.compare(plain, await this.dummyHash)
    return false
  }
}
