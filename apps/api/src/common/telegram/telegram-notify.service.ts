import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../prisma/prisma.service'
import type { EnvVars } from '../../config/env.schema'

// Исходящие уведомления в Telegram команде платформы.
//
// Единственное место, откуда платформа пишет в Telegram сама. Всё остальное в мини-аппе —
// ответы на запросы клиента; здесь наоборот, и потому здесь же вся осторожность:
//
// 1. Ошибка отправки НИКОГДА не роняет операцию. Уведомление — довесок к созданию жалобы
//    или обращения, и недоступный Telegram не должен мешать человеку пожаловаться.
// 2. Без токена или без привязок сервис молча ничего не делает — как Web Push без VAPID.
// 3. Текст уведомления не содержит ни жалобы, ни обращения. Telegram — чужая инфраструктура,
//    и пересылать туда чужие слова о третьих лицах незачем: сообщение говорит, ЧТО пришло,
//    а читается оно в мини-аппе.

const TELEGRAM_API = 'https://api.telegram.org'
const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]
const SEND_TIMEOUT_MS = 5_000

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  /**
   * Сообщить команде платформы. `deepLink` — параметр `startapp`, по которому мини-апп
   * откроет нужную карточку сразу, без блуждания по очереди.
   */
  async notifyStaff(text: string, deepLink?: string): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    if (!token) return

    const accounts = await this.prisma.telegramAccount.findMany({
      where: { revokedAt: null, user: { role: { in: [...STAFF_ROLES] }, isBlocked: false } },
      select: { telegramId: true },
      take: 100,
    })
    if (accounts.length === 0) return

    const markup = this.keyboard(deepLink)
    await Promise.all(
      accounts.map((account) => this.send(token, account.telegramId.toString(), text, markup)),
    )
  }

  /** Кнопка «открыть» — только если адрес мини-аппа задан; иначе уходит голый текст. */
  private keyboard(deepLink?: string): unknown | undefined {
    const base = this.config.get('MINI_APP_URL', { infer: true })
    if (!base) return undefined
    const url = deepLink ? `${base}?startapp=${encodeURIComponent(deepLink)}` : base
    return { inline_keyboard: [[{ text: 'Открыть', web_app: { url } }]] }
  }

  private async send(
    token: string,
    chatId: string,
    text: string,
    replyMarkup?: unknown,
  ): Promise<void> {
    try {
      const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      if (!response.ok) {
        // Частый случай — человек не начинал диалог с ботом (403): писать ему нельзя,
        // и это не повод для тревоги в логах уровнем выше.
        this.logger.warn(`Telegram отклонил отправку (${response.status})`)
      }
    } catch (error) {
      this.logger.warn(`Не удалось отправить уведомление в Telegram: ${String(error)}`)
    }
  }
}
