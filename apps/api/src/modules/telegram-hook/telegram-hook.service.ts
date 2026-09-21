import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { SupportService } from '../chats/support.service'
import { ComplaintsService } from '../complaints/complaints.service'

// Входящие обновления от бота: единственное место, где Telegram пишет НАМ.
//
// Пока обновление одно — нажатие инлайн-кнопки «Беру в работу» под уведомлением. Смысл
// в том, чтобы снять дубли работы: уведомление о срочной жалобе уходит всей команде, и
// без квитирования двое открывают одно и то же, а третье не берёт никто.
//
// Осторожность здесь та же, что в исходящих уведомлениях, и ещё немного:
//
// 1. Тело запроса — данные из интернета. Ни одно поле из него не становится ролью,
//    правами или scope: человека определяет ТОЛЬКО привязка `telegram_accounts` по
//    telegramId, а права — роль из нашей базы.
// 2. Ошибка обработки не превращается в ошибку ответа. Telegram повторяет обновление,
//    на которое не ответили 200, — и повторяет часами.
// 3. Ответ пользователю уходит всплывающей подсказкой, а кнопка снимается: нажатая
//    кнопка, которая осталась на месте, приглашает нажать ещё раз.

const TELEGRAM_API = 'https://api.telegram.org'
const CALL_TIMEOUT_MS = 5_000
const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

/** `take:ticket:<id>` | `take:complaint:<id>` — всё, что бот присылает нажатием. */
export interface CallbackQuery {
  id: string
  data?: string
  from?: { id?: number | string }
  message?: { chat?: { id?: number | string }; message_id?: number; text?: string }
}

@Injectable()
export class TelegramHookService {
  private readonly logger = new Logger(TelegramHookService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly support: SupportService,
    private readonly complaints: ComplaintsService,
  ) {}

  /** Совпадает ли секрет из заголовка с настроенным. Секрета нет — вебхук выключен. */
  secretMatches(header: string | undefined): boolean {
    const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true })
    return Boolean(secret) && header === secret
  }

  /**
   * Обработать нажатие. Ответ — текст всплывающей подсказки; исключения наружу не летят,
   * потому что неотвеченное обновление Telegram повторяет часами.
   */
  async handleCallback(query: CallbackQuery): Promise<void> {
    const answer = await this.resolve(query).catch((error: unknown) => {
      // Отказы сервиса («уже разбирает другой») — это ответ человеку, а не сбой.
      if (error instanceof AppException) return error.message
      this.logger.warn(`Нажатие в Telegram не обработано: ${String(error)}`)
      return 'Не получилось. Откройте мини-апп'
    })

    await this.answer(query.id, answer)
    // Кнопку снимаем в любом исходе: если взять не удалось, она всё равно больше не нужна
    // тому, кто нажал, а если удалось — тем более.
    await this.dropKeyboard(query)
  }

  private async resolve(query: CallbackQuery): Promise<string> {
    const [action, kind, id] = (query.data ?? '').split(':')
    if (action !== 'take' || !id) return 'Кнопка устарела'

    const actor = await this.actorFor(query.from?.id)
    if (!actor) return 'Telegram не привязан к аккаунту платформы'

    if (kind === 'ticket') {
      await this.support.assign(actor, id, true)
      return 'Обращение за вами'
    }
    if (kind === 'complaint') {
      await this.complaints.take(actor, id)
      return 'Жалоба за вами'
    }
    return 'Кнопка устарела'
  }

  /**
   * Кто нажал. Никаких данных из тела обновления, кроме telegramId: роль и scope читаются
   * из нашей базы — иначе достаточно было бы прислать «я админ» вместе с нажатием.
   */
  private async actorFor(telegramId: number | string | undefined): Promise<JwtPayload | null> {
    if (telegramId === undefined) return null
    const account = await this.prisma.telegramAccount.findFirst({
      where: { telegramId: BigInt(telegramId), revokedAt: null },
      select: {
        user: {
          select: {
            id: true,
            role: true,
            isBlocked: true,
            universityId: true,
            facultyId: true,
            groupId: true,
          },
        },
      },
    })
    const user = account?.user
    if (!user || user.isBlocked) return null
    if (!STAFF_ROLES.includes(user.role as Role)) return null

    return {
      sub: user.id,
      role: user.role as Role,
      universityId: user.universityId,
      facultyId: user.facultyId,
      groupId: user.groupId,
    } as JwtPayload
  }

  private async answer(callbackId: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, text })
  }

  private async dropKeyboard(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat?.id
    const messageId = query.message?.message_id
    if (chatId === undefined || messageId === undefined) return
    await this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    })
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    if (!token) return
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })
      if (!response.ok) this.logger.warn(`Telegram отклонил ${method} (${response.status})`)
    } catch (error) {
      this.logger.warn(`Не удалось вызвать ${method}: ${String(error)}`)
    }
  }
}
