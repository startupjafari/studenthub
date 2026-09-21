import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from '@studenthub/shared-types'
import type { NotificationKind } from '@studenthub/shared-schemas'
import { PrismaService } from '../prisma/prisma.service'
import type { EnvVars } from '../../config/env.schema'
import { PLATFORM_STATE, type PlatformStateReader } from '../../modules/platform/platform.constants'

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

/**
 * Попадает ли момент в окно тишины. Окно задают как «с 22 до 8», то есть через полночь —
 * поэтому сравнение не «между», а «вне диапазона» при from > to.
 *
 * `from === to` означает тишину круглые сутки: так уведомления выключают, не стирая
 * настройку. Любое null — тишины нет.
 */
export function isQuiet(from: number | null, to: number | null, now: Date): boolean {
  if (from === null || to === null) return false
  if (from === to) return true
  const hour = now.getHours()
  return from < to ? hour >= from && hour < to : hour >= from || hour < to
}

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    // По токену, а не по классу: импорт PlatformService втянул бы сюда домен auth
    // целиком и замкнул кольцо импортов (см. platform.constants.ts).
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
  ) {}

  /**
   * Сообщить команде платформы. `deepLink` — параметр `startapp`, по которому мини-апп
   * откроет нужную карточку сразу, без блуждания по очереди.
   */
  async notifyStaff(
    kind: NotificationKind,
    text: string,
    deepLink?: string,
    now: Date = new Date(),
    /**
     * Эскалация: письмо уходит администраторам и МИМО дежурства и тихих часов.
     * Эскалируют ровно тогда, когда обычный путь не сработал, — глушить её теми же
     * правилами значило бы глушить именно тот сигнал, ради которого её и завели.
     */
    escalate = false,
  ): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    if (!token) return

    // Настройки читаются перед каждой отправкой, а не кэшируются здесь: выключить
    // уведомления обычно хотят прямо сейчас, а не «в течение часа».
    const policy = escalate ? null : await this.platform.notificationPolicy().catch(() => null)
    if (policy) {
      if (policy.muted.includes(kind)) return
      if (isQuiet(policy.quietFrom, policy.quietTo, now)) return
    }

    const accounts = await this.prisma.telegramAccount.findMany({
      where: {
        revokedAt: null,
        user: {
          role: { in: escalate ? [Role.PLATFORM_ADMIN] : [...STAFF_ROLES] },
          isBlocked: false,
        },
        // Дежурный задан — пишем только ему: сообщение всей команде означает, что не
        // среагирует никто, каждый решит, что возьмёт другой.
        ...(policy?.dutyUserId ? { userId: policy.dutyUserId } : {}),
      },
      select: { telegramId: true },
      take: 100,
    })
    if (accounts.length === 0) return

    const markup = this.keyboard(deepLink)
    await Promise.all(
      accounts.map((account) => this.send(token, account.telegramId.toString(), text, markup)),
    )
  }

  /**
   * Сообщение конкретному человеку в Telegram.
   *
   * Политика тишины и дежурства сюда НЕ применяется: это не оповещение команды о работе,
   * а подтверждение действия самому человеку — «твой Telegram только что привязали».
   * Заглушить такое значило бы скрыть от него изменение доступа к его же аккаунту.
   */
  async notifyOne(telegramId: bigint | string, text: string): Promise<void> {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    if (!token) return
    await this.send(token, telegramId.toString(), text, this.keyboard())
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
