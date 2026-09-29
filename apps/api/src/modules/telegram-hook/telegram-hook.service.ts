import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Client as MinioClient } from 'minio'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { PrismaService } from '../../common/prisma/prisma.service'
import { REDIS_CLIENT } from '../../common/redis/redis.module'
import { MINIO_CLIENT } from '../../common/minio/minio.module'
import { PLATFORM_STATE, type PlatformStateReader } from '../platform/platform.constants'
import { AppException } from '../../common/exceptions/app.exception'
import { equalsConstantTime } from '../../common/security/constant-time'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { SupportService } from '../chats/support.service'
import { ComplaintsService } from '../complaints/complaints.service'
import { digestText, humanAge } from '../../common/telegram/digest'

// Входящие обновления от бота: единственное место, где Telegram пишет НАМ.
//
// Два вида обновлений. Нажатие инлайн-кнопки «Беру в работу» под уведомлением — чтобы
// снять дубли работы: уведомление о срочной жалобе уходит всей команде, и без
// квитирования двое открывают одно и то же, а третье не берёт никто. И команды в личной
// переписке — чтобы ответить на вопрос «сколько там в очереди» без открытия приложения.
//
// Команды отвечают ЧИСЛАМИ и состоянием платформы, но не содержимым: ни текста жалобы,
// ни переписки поддержки, ни имён тех, о ком жалуются. Это то же правило, по которому
// устроены исходящие уведомления (common/telegram/telegram-notify.service.ts): Telegram —
// чужая инфраструктура, и чужие слова о третьих лицах туда не уходят.
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
// 4. Команды работают ТОЛЬКО в личной переписке. Бота можно добавить в группу, и там
//    рядом с сотрудником окажутся посторонние — отвечать очередью платформы в такой чат
//    нельзя. В группе бот молчит.

const TELEGRAM_API = 'https://api.telegram.org'
const CALL_TIMEOUT_MS = 5_000
const STAFF_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

/** Текстовое сообщение боту. Из него используется только команда и отправитель. */
export interface TelegramMessage {
  text?: string
  from?: { id?: number | string }
  chat?: { id?: number | string; type?: string }
}

/** `take:ticket:<id>` | `take:complaint:<id>` — всё, что бот присылает нажатием. */
export interface CallbackQuery {
  id: string
  data?: string
  from?: { id?: number | string }
  message?: { chat?: { id?: number | string }; message_id?: number; text?: string }
}

/**
 * Команды бота. Один список на три места: справка в переписке, меню команд в Telegram
 * (`setMyCommands`) и разбор входящего сообщения. Разойдясь, они начали бы обещать разное:
 * меню предлагало бы команду, на которую бот молчит, — а это хуже пустого меню.
 */
const BOT_COMMANDS: readonly { command: string; description: string }[] = [
  { command: 'queue', description: 'Что ждёт разбора прямо сейчас' },
  { command: 'digest', description: 'Сводка за сутки' },
  { command: 'duty', description: 'Кто дежурит и что с тихими часами' },
  { command: 'status', description: 'Техработы и живость сервисов' },
  { command: 'me', description: 'Кем бот меня видит' },
  { command: 'help', description: 'Что умеет бот' },
]

/**
 * Тексты ответов. Вынесены из методов, потому что их читает человек, а не программа:
 * править формулировку удобнее там, где видно все сразу.
 */
const HELP = [
  'Бот пишет команде платформы StudentHub: новые жалобы, обращения в поддержку, ответы и',
  'ежедневная сводка. Разбор — в мини-аппе, кнопка «Открыть» ниже.',
  '',
  'Команды:',
  ...BOT_COMMANDS.map(({ command, description }) => `/${command} — ${description}`),
].join('\n')

/**
 * Описание бота на пустом экране переписки — то, что человек читает ДО первого `/start`,
 * и единственное место, где бот объясняет себя, пока ему не написали.
 */
const ABOUT = [
  'Служебный бот платформы StudentHub.',
  '',
  'Пишет команде платформы о новых жалобах, обращениях в поддержку и авариях, отвечает на',
  'команды о состоянии очереди и раз в сутки присылает сводку. Разбор — в мини-аппе.',
  'Тем, чей Telegram не привязан к аккаунту платформы, бот не отвечает ничем.',
].join('\n')

/** Строка под именем бота в профиле. Telegram режет её по 120 символам. */
const SHORT_ABOUT = 'Служебный бот StudentHub: очередь, дежурство и состояние сервисов.'

/** Окно, за которое считается движение в сводке. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Роль по-русски. Сюда доходят только две: остальных `actorFor` не пропускает. */
const ROLE_WORD: Partial<Record<Role, string>> = {
  [Role.PLATFORM_ADMIN]: 'администратор платформы',
  [Role.PLATFORM_MODERATOR]: 'модератор платформы',
}

/**
 * Ответ тому, чей Telegram не привязан. Никаких данных: это единственный ответ, который
 * бот даёт постороннему, и по нему нельзя понять даже, есть ли на платформе очередь.
 */
const UNLINKED = [
  'Это служебный бот платформы StudentHub. Он пишет только её команде.',
  '',
  'Ваш Telegram не привязан к аккаунту платформы. Привязка делается в веб-интерфейсе:',
  'Настройки → «Мини-апп в Telegram», там выдаётся код.',
].join('\n')

/**
 * Имя команды из текста сообщения, либо null, если это не команда.
 *
 * Обычный текст тоже считаем обращением за помощью и отвечаем справкой: человек написал
 * боту не просто так, а молчание он читает как поломку. `@ИмяБота` в конце отрезаем —
 * Telegram дописывает его в группах и иногда при автодополнении.
 */
export function parseCommand(text: string | undefined): string | null {
  const trimmed = text?.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith('/')) return 'help'
  const word = trimmed.slice(1).split(/[\s@]/, 1)[0]?.toLowerCase()
  return word ? word : 'help'
}

/** Следующий в очереди дежурства после текущего; по кругу. */
export function nextInRotation(duty: {
  dutyUserId: string | null
  rotation: string[]
}): string | null {
  const { rotation, dutyUserId } = duty
  if (rotation.length === 0) return null
  const index = dutyUserId ? rotation.indexOf(dutyUserId) : -1
  // Дежурного нет в списке (назначили руками) — следующим считается первый по очереди.
  return rotation[index === -1 ? 0 : (index + 1) % rotation.length] ?? null
}

@Injectable()
export class TelegramHookService implements OnModuleInit {
  private readonly logger = new Logger(TelegramHookService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly support: SupportService,
    private readonly complaints: ComplaintsService,
    @Inject(PLATFORM_STATE) private readonly platform: PlatformStateReader,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MINIO_CLIENT) private readonly minio: MinioClient,
  ) {}

  /**
   * Рассказать Telegram о боте: меню команд, описание на пустом экране переписки и строку
   * в профиле.
   *
   * Без этого команды существуют только в коде: в переписке не видно ни кнопки «Меню», ни
   * подсказок при вводе `/`, и человек, открывший бота впервые, видит пустой экран без
   * единого слова о том, что здесь можно спросить.
   *
   * Не ждём ответа и не роняем старт: Telegram — чужая инфраструктура, и её недоступность
   * не повод не поднять API. Вызовы идемпотентны, поэтому повтор при каждом рестарте
   * безвреден.
   */
  onModuleInit(): void {
    void this.syncProfile()
  }

  private async syncProfile(): Promise<void> {
    if (!this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })) return
    // Меню рисуем, только когда настроен вебхук: без него входящие сообщения до нас не
    // доходят, и список команд, ни одна из которых не отвечает, хуже пустого меню.
    if (!this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true })) return

    await this.call('setMyCommands', {
      commands: BOT_COMMANDS,
      // Только личная переписка: в группе бот молчит, и команды там обещали бы ответ,
      // которого не будет.
      scope: { type: 'all_private_chats' },
    })
    await this.call('setMyDescription', { description: ABOUT })
    await this.call('setMyShortDescription', { short_description: SHORT_ABOUT })
  }

  /**
   * Совпадает ли секрет из заголовка с настроенным. Секрета нет — вебхук выключен.
   *
   * Сравнение за постоянное время: адрес вебхука публичен, и заголовок сюда может слать
   * кто угодно сколько угодно раз — то есть ровно те условия, в которых замеряют время.
   */
  secretMatches(header: string | undefined): boolean {
    const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true })
    if (!secret || !header) return false
    return equalsConstantTime(header, secret)
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

  // ── Команды в личной переписке ─────────────────────────────────────────────

  /**
   * Обработать сообщение боту.
   *
   * Отвечаем и на неизвестную команду, и на обычный текст: человек, написавший боту,
   * ждёт ответа, а молчание он читает как поломку — именно так и выглядел `/start` до
   * этой правки. Ответ при этом одинаковый и никаких данных не содержит.
   */
  async handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat?.id
    if (chatId === undefined) return
    // В группе бот молчит: рядом с сотрудником там могут быть посторонние.
    if (message.chat?.type !== 'private') return

    const command = parseCommand(message.text)
    if (command === null) return

    const actor = await this.actorFor(message.from?.id)
    if (!actor) {
      await this.reply(chatId, UNLINKED)
      return
    }

    const text = await this.runCommand(command, actor).catch((error: unknown) => {
      this.logger.warn(`Команда ${command} не выполнена: ${String(error)}`)
      return 'Не получилось получить данные. Попробуйте открыть мини-апп'
    })
    await this.reply(chatId, text)
  }

  private async runCommand(command: string, actor: JwtPayload): Promise<string> {
    switch (command) {
      case 'queue':
        return this.queueText()
      case 'digest':
        return this.digestReply()
      case 'duty':
        return this.dutyText()
      case 'status':
        return this.statusText()
      case 'me':
        return this.meText(actor)
      default:
        return HELP
    }
  }

  /** Сколько работы в очереди и сколько ждёт самое старое. Числа, без содержимого. */
  private async queueText(): Promise<string> {
    const [complaints, tickets] = await Promise.all([
      this.complaints.queueStats(),
      this.support.queueStats(),
    ])
    const lines = [`Жалоб в очереди: ${complaints.count}`, `Открытых обращений: ${tickets.count}`]
    // Возраст показываем только когда очередь непуста: «старейшее ждёт —» на нулевой
    // очереди это строка ни о чём.
    const oldest = [complaints.oldestAt, tickets.oldestAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    if (oldest) lines.push(`Старейшее ждёт: ${humanAge(Date.now() - oldest.getTime())}`)
    return lines.join('\n')
  }

  /**
   * Та же сводка, что приходит раз в сутки, но по запросу.
   *
   * Сводка приходит в выбранный час, а спрашивают «что там за сутки» когда угодно — чаще
   * всего вернувшись к работе через день. Текст собирает общая функция: сводка из крона и
   * сводка по запросу обязаны отвечать одинаково.
   */
  private async digestReply(): Promise<string> {
    const since = new Date(Date.now() - DAY_MS)
    const [complaints, tickets, complaintsDay, ticketsDay, duty] = await Promise.all([
      this.complaints.queueStats(),
      this.support.queueStats(),
      this.complaints.dayStats(since),
      this.support.dayStats(since),
      this.platform.duty(),
    ])
    const names = await this.namesOf(duty.dutyUserId ? [duty.dutyUserId] : [])
    return digestText({
      complaints: { ...complaints, ...complaintsDay },
      tickets: { ...tickets, ...ticketsDay },
      dutyName: duty.dutyUserId ? (names.get(duty.dutyUserId) ?? null) : null,
    })
  }

  /**
   * Кем бот видит написавшего.
   *
   * Вопрос «а я вообще привязан и почему мне ничего не приходит» возникает раньше всех
   * остальных: уведомления молчат и когда Telegram не привязан, и когда дежурит другой, и
   * когда идут тихие часы — а выглядит это одинаково. Здесь видно, какая из трёх причин.
   */
  private async meText(actor: JwtPayload): Promise<string> {
    const [account, duty] = await Promise.all([
      this.prisma.telegramAccount.findFirst({
        where: { userId: actor.sub, revokedAt: null },
        select: { linkedAt: true, user: { select: { firstName: true, lastName: true } } },
      }),
      this.platform.duty(),
    ])
    if (!account) return UNLINKED

    const lines = [
      `Вы: ${`${account.user.firstName} ${account.user.lastName}`.trim()}`,
      `Роль: ${ROLE_WORD[actor.role] ?? actor.role}`,
      `Telegram привязан: ${account.linkedAt.toLocaleDateString('ru-RU')}`,
    ]
    lines.push(
      duty.dutyUserId === null
        ? 'Дежурного нет — уведомления приходят всей команде'
        : duty.dutyUserId === actor.sub
          ? 'Сейчас дежурите вы — уведомления приходят только вам'
          : 'Дежурит другой — уведомления идут ему, не вам',
    )
    return lines.join('\n')
  }

  /** Кто разбирает сейчас, кто следующий и что с тишиной. */
  private async dutyText(): Promise<string> {
    const [duty, policy] = await Promise.all([
      this.platform.duty(),
      this.platform.notificationPolicy(),
    ])

    const ids = [duty.dutyUserId, nextInRotation(duty)].filter((id): id is string => id !== null)
    const names = await this.namesOf(ids)

    const lines = [
      duty.dutyUserId
        ? `Дежурит: ${names.get(duty.dutyUserId) ?? 'неизвестно кто'}`
        : 'Дежурного нет — уведомления уходят всей команде',
    ]
    const next = nextInRotation(duty)
    if (next && next !== duty.dutyUserId) lines.push(`Следующий: ${names.get(next) ?? '—'}`)

    lines.push(
      policy.quietFrom === null || policy.quietTo === null
        ? 'Тихих часов нет'
        : policy.quietFrom === policy.quietTo
          ? 'Уведомления выключены круглые сутки'
          : `Тихие часы: с ${policy.quietFrom}:00 до ${policy.quietTo}:00`,
    )
    if (policy.digestHour !== null) lines.push(`Сводка приходит в ${policy.digestHour}:00`)
    if (policy.muted.length > 0) lines.push(`Отключено: ${policy.muted.join(', ')}`)
    return lines.join('\n')
  }

  /**
   * Что сейчас с платформой: техработы и живость зависимостей.
   *
   * Проверки живые, а не из кэша сторожа: `/status` спрашивают именно тогда, когда
   * что-то подозревают, и ответ пятиминутной давности в этот момент бесполезен.
   */
  private async statusText(): Promise<string> {
    const [maintenance, db, redis, storage] = await Promise.all([
      this.platform.maintenanceActive().catch(() => false),
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis
        .ping()
        .then(() => true)
        .catch(() => false),
      this.minio
        .bucketExists(this.config.get('MINIO_BUCKET_AVATARS', { infer: true }))
        .then(() => true)
        .catch(() => false),
    ])

    const down = [
      db ? null : 'база данных',
      redis ? null : 'Redis',
      storage ? null : 'хранилище',
    ].filter((name): name is string => name !== null)

    return [
      maintenance ? 'Идут техработы' : 'Техработ нет',
      down.length === 0 ? 'Все сервисы отвечают' : `Не отвечает: ${down.join(', ')}`,
    ].join('\n')
  }

  /** Имена по id. Только команда платформы — тех, о ком жалуются, здесь нет и быть не может. */
  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
      take: ids.length,
    })
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
  }

  /** Ответ в тот же чат. С кнопкой «Открыть», если адрес мини-аппа задан. */
  private async reply(chatId: number | string, text: string): Promise<void> {
    const base = this.config.get('MINI_APP_URL', { infer: true })
    await this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...(base
        ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: base } }]] } }
        : {}),
    })
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
