import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public, MaintenanceExempt } from '../../common/decorators'
import { TelegramHookService, type CallbackQuery } from './telegram-hook.service'

// Приём обновлений от бота (docs/PROJECT.md §Мини-апп).
//
// Публичный маршрут, и иначе быть не может: Telegram приходит без нашего токена. Защита
// одна, зато надёжная — секрет, который бот присылает в заголовке и который знают только
// он и мы (`setWebhook` с `secret_token`). Секрет не настроен — маршрут отвечает 200 и
// ничего не делает: открытая ручка без проверки хуже её отсутствия.
//
// Ответ ВСЕГДА 200. Обновление, на которое не ответили, Telegram повторяет часами, и
// цепочка повторов ради «у нас ошибка» кончается тем, что бот отключает вебхук.

@ApiExcludeController()
@Public()
// Техработы это не касается: кнопка «беру в работу» нужна как раз тогда, когда что-то
// случилось, а гасить её вместе с платформой значило бы гасить разбор аварии.
@MaintenanceExempt()
@Controller('telegram')
export class TelegramHookController {
  constructor(private readonly hook: TelegramHookService) {}

  @Post('webhook')
  @HttpCode(200)
  // Telegram шлёт обновления пачками при всплеске; 120 в минуту — с запасом на живую
  // команду и без запаса на то, чтобы кто-то посторонний долбился в открытый адрес.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async update(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: { callback_query?: CallbackQuery } | undefined,
  ): Promise<{ ok: true }> {
    if (!this.hook.secretMatches(secret)) return { ok: true }
    if (body?.callback_query) await this.hook.handleCallback(body.callback_query)
    return { ok: true }
  }
}
