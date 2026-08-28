import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OPS_NOTIFIER, type OpsNotifier } from '../../common/monitoring'
import type { EnvVars } from '../../config/env.schema'
import { MigrationsCheck } from './checks/migrations.check'
import type { OpsCommand } from './hooks/telegram.mapper'
import { OpsMessageBuilder } from './ops-message.builder'
import { OpsPolicyService } from './ops-policy.service'
import { OpsStatusService } from './ops-status.service'
import { TelegramOpsService } from './telegram-ops.service'

// Команды бота (docs/TELEGRAM_BOT.md §6).
//
// Все — ТОЛЬКО ЧТЕНИЕ. `/quiet` — единственная, что-то меняющая, и меняет она состояние
// самого бота, а не платформы (§0.1.2). Команд, затрагивающих платформу, нет и не будет:
// токен бота живёт в телефоне и утекает вместе с ним.
//
// Числа берутся из `OpsStatusService` — того же источника, что закреплённое сообщение
// и сводка (§7.1.5), поэтому `/status` и шапка канала не могут разойтись.

/** Максимальная тишина: `/quiet 12h` — это уже не «работы», а забытая команда. */
const MAX_QUIET_MS = 12 * 60 * 60 * 1000

const HELP = [
  '/status — версия, аптайм, зависимости, очереди',
  '/queues — глубина очередей',
  '/migrations — применённые и неприменённые миграции',
  '/quiet 2h · /quiet off — тишина на время работ',
].join('\n')

@Injectable()
export class OpsCommandService {
  private readonly logger = new Logger(OpsCommandService.name)

  constructor(
    private readonly status: OpsStatusService,
    private readonly migrations: MigrationsCheck,
    private readonly policy: OpsPolicyService,
    private readonly builder: OpsMessageBuilder,
    private readonly telegram: TelegramOpsService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(OPS_NOTIFIER) private readonly notifier: OpsNotifier,
  ) {}

  async handle(command: OpsCommand): Promise<void> {
    // Allowlist по chat_id: апдейты из других чатов игнорируются МОЛЧА (§6). Ответ
    // «недоступно» подтвердил бы чужому, что бот жив и куда-то подключён.
    const allowed = this.config.get('TELEGRAM_OPS_CHAT_ID', { infer: true })
    if (!allowed || command.chatId !== allowed) {
      this.logger.warn(`Команда ${command.command} из чужого чата — игнорируется`)
      return
    }

    const message = await this.answer(command)
    if (!message) return
    // Отвечаем в ту же тему, где спросили: ответ в общем потоке ищут потом всей командой.
    await this.telegram.send({ ...message, threadId: command.threadId })
  }

  private async answer(command: OpsCommand) {
    switch (command.command) {
      case 'status':
        return this.builder.buildStatus(await this.status.snapshot())
      case 'queues':
        return this.builder.buildQueues(await this.status.queues())
      case 'migrations': {
        const { applied, pending } = await this.migrations.state()
        return this.builder.buildMigrations(applied, pending)
      }
      case 'quiet':
        return this.quiet(command.argument)
      case 'help':
      case 'start':
        return this.builder.buildReply('info', `Команды:\n${HELP}`)
      default:
        // Чужие команды в общем чате — не наше дело. Молчим, чтобы не спорить с другими ботами.
        return null
    }
  }

  /**
   * Тишина на время работ (§3.5). Плановая миграция не должна порождать сорок сообщений,
   * но 🔴 сквозь тишину проходят: авария во время работ — это тем более авария.
   */
  private async quiet(argument: string) {
    if (argument === 'off' || argument === 'стоп') {
      const summary = await this.policy.endQuiet()
      if (!summary) return this.builder.buildReply('info', 'Тишины не было')
      this.notifier.emit('quietEnded', {
        summary: `${summary.total} событий, из них ${summary.red} красных`,
      })
      return null
    }

    const ms = parseDuration(argument)
    if (!ms) {
      return this.builder.buildReply('warn', 'Как: /quiet 30m · /quiet 2h · /quiet off')
    }
    if (ms > MAX_QUIET_MS) {
      return this.builder.buildReply('warn', 'Максимум 12 часов — дольше это уже не работы')
    }

    const until = await this.policy.startQuiet(ms)
    this.notifier.emit('quietStarted', {
      until: until.toISOString().slice(11, 16) + ' UTC',
      passes: 'только 🔴',
    })
    return null
  }
}

/** `30m`, `2h`, `90` (минуты по умолчанию). Всё остальное — не длительность. */
function parseDuration(input: string): number | null {
  const match = /^(\d+)\s*(m|h|м|ч)?$/.exec(input.trim())
  if (!match) return null
  const value = Number(match[1])
  if (!value) return null
  const hours = match[2] === 'h' || match[2] === 'ч'
  return value * (hours ? 60 : 1) * 60_000
}
