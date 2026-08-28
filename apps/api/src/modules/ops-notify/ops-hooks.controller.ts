import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { ApiExcludeController } from '@nestjs/swagger'
import type { RawBodyRequest } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators'
import { AppException } from '../../common/exceptions/app.exception'
import { OPS_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { githubSignatureMatches, secretMatches } from './hooks/hook-signature'
import { mapGithubHook } from './hooks/github.mapper'
import { mapRailwayHook } from './hooks/railway.mapper'
import { mapSentryHook } from './hooks/sentry.mapper'
import { mapTelegramUpdate } from './hooks/telegram.mapper'
import type { HookPayload, OpsHookEvent } from './hooks/ops-event.type'

// Приём вебхуков Railway / Sentry / GitHub (docs/TELEGRAM_BOT.md §5, T-7/T-8).
//
// Контроллер тонкий по правилу §7.3.2: проверить подпись, отдать тело мапперу, положить
// результат в очередь. Ни бизнес-логики, ни обращений к БД, ни ожидания сети — внешние
// сервисы считают вебхук упавшим по таймауту, а не по коду ответа.
//
// Поверхность минимальная (§7.2.4):
//   • эндпоинты публичные, поэтому обязателен секрет: `X-Ops-Secret` для Railway и Sentry,
//     штатная подпись `X-Hub-Signature-256` для GitHub — сравнение через timingSafeEqual;
//   • отдельный throttler, строже глобального;
//   • ограничение размера тела: в payload'ах Sentry ездят стектрейсы;
//   • тело НЕ логируется целиком — там email коммитеров и фрагменты трейсов (§5);
//   • неизвестный источник → 404 без подсказок, неверная подпись → 401 без деталей.
//
// Источник `telegram` — это входящие апдейты для команд бота (§6): у него свой секрет
// (`X-Telegram-Bot-Api-Secret-Token`, задаётся при setWebhook) и свой обработчик, потому
// что команда требует ОТВЕТА, а не события в канале. Allowlist по chat_id проверяется
// в обработчике: контроллер остаётся тонким.
//
// Из Swagger контроллер исключён намеренно: это служебный вход, и публиковать его схему
// в документации API незачем.

/** Тело больше — почти наверняка не наш вебхук. Sentry с полным трейсом укладывается. */
const MAX_BODY_BYTES = 128 * 1024

const MAPPERS: Record<string, (payload: HookPayload) => OpsHookEvent | null> = {
  railway: mapRailwayHook,
  sentry: mapSentryHook,
  github: mapGithubHook,
}

@ApiExcludeController()
@Controller('ops/hooks')
export class OpsHooksController {
  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':source')
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Param('source') source: string,
    @Body() body: HookPayload,
    @Headers('x-ops-secret') opsSecret: string | undefined,
    @Headers('x-hub-signature-256') githubSignature: string | undefined,
    @Headers('x-telegram-bot-api-secret-token') telegramSecret: string | undefined,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<null> {
    if (source === 'telegram') {
      return this.receiveTelegram(body, telegramSecret)
    }

    const mapper = MAPPERS[source]
    // Неизвестный источник — 404 и ничего больше: перебирать имена по разным ответам нельзя.
    if (!mapper) throw new AppException('NOT_FOUND', 'Не найдено')

    const secret = this.config.get('OPS_HOOK_SECRET', { infer: true })
    // Секрет не задан — вход закрыт. Открытый приём событий «пока не настроили» это
    // публичный эндпоинт, которым может воспользоваться кто угодно.
    if (!secret) throw new AppException('UNAUTHORIZED', 'Недоступно')

    const authentic =
      source === 'github'
        ? githubSignatureMatches(githubSignature, secret, request.rawBody)
        : secretMatches(opsSecret, secret)
    // Без деталей: «неверная подпись» и «нет заголовка» для отправителя неразличимы.
    if (!authentic) throw new AppException('UNAUTHORIZED', 'Недоступно')

    if ((request.rawBody?.length ?? 0) > MAX_BODY_BYTES) {
      throw new AppException('BAD_REQUEST', 'Слишком большое тело')
    }

    const mapped = mapper(body)
    // Событие нас не касается — это норма, а не ошибка: внешние сервисы шлют всё подряд.
    if (mapped) {
      await this.queue.enqueue(QUEUES.OPS_NOTIFY, OPS_JOBS.EMIT, mapped)
    }
    return null
  }

  /**
   * Апдейты Telegram для команд бота (§6).
   *
   * Секрет — `secret_token`, который мы сами задали при `setWebhook`: Telegram присылает
   * его заголовком в каждом апдейте. Не задан у нас — команды выключены, и вход закрыт.
   *
   * Отвечаем немедленно: Telegram считает вебхук упавшим по таймауту и начинает слать
   * апдейт повторно, а команда, исполненная трижды, — это три сообщения в канал.
   */
  private async receiveTelegram(
    body: HookPayload,
    providedSecret: string | undefined,
  ): Promise<null> {
    const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true })
    if (!secret || !secretMatches(providedSecret, secret)) {
      throw new AppException('UNAUTHORIZED', 'Недоступно')
    }

    const command = mapTelegramUpdate(body)
    // Обычное сообщение в группе, а не команда — норма: апдейты приходят на всё подряд.
    if (command) {
      await this.queue.enqueue(QUEUES.OPS_NOTIFY, OPS_JOBS.COMMAND, command)
    }
    return null
  }
}
