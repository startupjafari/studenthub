import { Injectable, Logger } from '@nestjs/common'
import { OpsMessageBuilder } from '../ops-message.builder'
import { OpsStatusService } from '../ops-status.service'
import { TelegramOpsService } from '../telegram-ops.service'

// T-11 (docs/TELEGRAM_BOT.md §2.3): вечерняя сводка одним сообщением.
//
// Это не алерт — здесь смотрят на тренд, а не бегут чинить. Отсюда и устройство: одно
// сообщение в сутки со всеми строками, без звука, в тему «Сводки».
//
// Мимо реестра событий и политики — сознательно, по той же причине, что закреплённый
// статус: сводка не событие, у неё нет дедупликации и троттлинга, а тишина на время работ
// её глушить не должна — работы кончатся, а сводка за эти сутки уже не повторится.
// Транспорт при этом общий (§7.1.1), текст собирает общий билдер (§7.1.2).

@Injectable()
export class DigestCheck {
  private readonly logger = new Logger(DigestCheck.name)

  constructor(
    private readonly status: OpsStatusService,
    private readonly builder: OpsMessageBuilder,
    private readonly telegram: TelegramOpsService,
  ) {}

  async run(): Promise<void> {
    const message = this.builder.buildDigest(await this.status.digest())
    await this.telegram.send(message)
    this.logger.log('Суточная сводка отправлена')
  }
}
