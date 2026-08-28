import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../../common/redis/redis.constants'
import { OpsMessageBuilder } from '../ops-message.builder'
import { OpsStatusService } from '../ops-status.service'
import { TelegramOpsService } from '../telegram-ops.service'

// T-10 (docs/TELEGRAM_BOT.md §3.3): одно закреплённое сообщение, которое бот переписывает.
// Открыл канал, посмотрел вверх — видно версию, аптайм, зависимости и очереди; дёргать
// команду не нужно.
//
// Три требования, каждое со своей строкой кода:
//   • правки не будят никого — `disable_notification` при отправке, а правка и так тиха;
//   • содержимое не изменилось — не редактируем вовсе, иначе Telegram отвечает
//     `message is not modified` и засоряет лог;
//   • `message_id` переживает рестарт — он в Redis, а не в памяти процесса.
//
// Это единственное сообщение модуля, которое не проходит через реестр событий: оно и не
// событие, а живое состояние. Транспорт при этом тот же (§7.1.1), текст собирает тот же
// билдер (§7.1.2) — исключение только в том, что политика доставки к нему неприменима.

const MESSAGE_ID_KEY = 'ops:pinned:message-id'
const HASH_KEY = 'ops:pinned:hash'

@Injectable()
export class PinnedStatusCheck {
  private readonly logger = new Logger(PinnedStatusCheck.name)

  constructor(
    private readonly status: OpsStatusService,
    private readonly builder: OpsMessageBuilder,
    private readonly telegram: TelegramOpsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async run(): Promise<void> {
    const message = this.builder.buildStatus(await this.status.snapshot())

    // Хэшируем текст БЕЗ строки «обновлено»: она меняется каждые пять минут, и с ней
    // «не изменилось — не редактируем» никогда бы не срабатывало.
    const hash = digest(withoutTimestamp(message.text))

    const [messageId, previousHash] = await this.redis.mget(MESSAGE_ID_KEY, HASH_KEY)
    if (messageId && previousHash === hash) return

    if (!messageId) {
      await this.publish(message, hash)
      return
    }

    const outcome = await this.telegram.edit(Number(messageId), message)
    if (outcome === 'ok') {
      await this.redis.set(HASH_KEY, hash)
      return
    }
    if (outcome === 'failed') {
      // Сеть моргнула — новое сообщение не шлём, иначе каждый сбой оставлял бы в канале
      // ещё один «статус». Перепишем на следующей проверке.
      this.logger.warn('Не удалось обновить закреплённый статус, повтор через проверку')
      return
    }

    // `gone`: сообщение удалили руками или его больше нельзя править — публикуем заново.
    this.logger.log('Закреплённый статус исчез — публикуем новый')
    await this.publish(message, hash)
  }

  private async publish(
    message: ReturnType<OpsMessageBuilder['buildStatus']>,
    hash: string,
  ): Promise<void> {
    const messageId = await this.telegram.send(message)
    if (!messageId) return
    await this.telegram.pin(messageId)
    await this.redis.mset(MESSAGE_ID_KEY, String(messageId), HASH_KEY, hash)
  }
}

/** Строка «обновлено: …» меняется всегда и для сравнения содержимого бесполезна. */
function withoutTimestamp(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.startsWith('обновлено:'))
    .join('\n')
}

function digest(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}
