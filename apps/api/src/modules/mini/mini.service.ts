import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { randomInt } from 'node:crypto'
import type Redis from 'ioredis'
import { Role } from '@studenthub/shared-types'
import { MINI_LINK_CODE_LENGTH } from '@studenthub/shared-schemas'
import { AppException } from '../../common/exceptions/app.exception'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { verifyInitData } from './init-data'

// Вход в админский мини-апп (docs/PROJECT.md §8.3).
//
// Три операции и жёсткий порядок доверия между ними:
//   1) `issueLinkCode` — в ВЕБЕ, залогиненный админ получает одноразовый код. Здесь и
//      только здесь платформа знает, кто человек: он уже прошёл логин и 2FA.
//   2) `link` — в мини-аппе: код + подписанный initData. Код доказывает «это тот админ»,
//      подпись — «это действительно Telegram». По отдельности ни то, ни другое не годится.
//   3) `session` — при каждом открытии: подпись, свежесть, привязка, роль СЕЙЧАС.
//
// Роль перечитывается из БД на каждую сессию, а не берётся из привязки: человека могли
// разжаловать вчера, и пятнадцатиминутный токен — максимальное окно, в течение которого
// он этого не заметит.

/** Сколько живёт код привязки. Пять минут — дойти из веба в Telegram, не больше. */
const LINK_CODE_TTL_SEC = 5 * 60

/**
 * Сколько живёт токен мини-аппа. Refresh-токена нет намеренно: истёк — клиент молча
 * присылает свежий initData, он у него всегда под рукой. Отсюда отсутствие cookie,
 * а значит и вопросов с SameSite на чужом домене.
 */
const SESSION_TTL_SEC = 15 * 60

/** Кто вообще может пользоваться мини-аппом. Университетские роли сюда не входят (§1). */
const ALLOWED_ROLES: readonly Role[] = [Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR]

/** Без похожих символов: код диктуют вслух и набирают на телефоне. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export interface MiniSession {
  token: string
  expiresIn: number
  user: { id: string; firstName: string; role: Role }
}

@Injectable()
export class MiniService {
  private readonly logger = new Logger(MiniService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Настроен ли бот. Без токена проверять подпись нечем — мини-апп просто выключен. */
  private botToken(): string {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true })
    // Наружу — тот же «нет доступа», что и при неверной подписи: по разнице ответов
    // не должно быть видно, настроен мини-апп или нет. Причина уходит в лог.
    if (!token) throw this.denied('TELEGRAM_BOT_TOKEN не задан — мини-апп выключен')
    return token
  }

  /**
   * Код привязки для залогиненного админа. Хранится в Redis: живёт минуты, переживать
   * рестарт ему незачем, а в БД он бы остался мусором навсегда.
   */
  async issueLinkCode(userId: string, role: Role): Promise<{ code: string; expiresIn: number }> {
    if (!ALLOWED_ROLES.includes(role)) {
      throw new AppException('FORBIDDEN', 'Мини-апп доступен администраторам платформы')
    }

    const code = Array.from(
      { length: MINI_LINK_CODE_LENGTH },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('')

    await this.redis.set(this.codeKey(code), userId, 'EX', LINK_CODE_TTL_SEC)
    await this.audit.record({
      userId,
      action: 'telegram.link_code_issued',
      metadata: { source: 'web' },
    })

    return { code, expiresIn: LINK_CODE_TTL_SEC }
  }

  /**
   * Привязка: код из веба + подписанный initData.
   *
   * Код гасится ДО всех прочих проверок и независимо от их исхода — иначе один код можно
   * было бы перебирать, подставляя разные initData.
   */
  async link(initData: string, code: string): Promise<MiniSession> {
    const verified = verifyInitData(initData, this.botToken())
    if (!verified.ok) throw this.denied(`link: ${verified.reason}`)

    // Читаем и гасим одной транзакцией: GETDEL есть только с Redis 6.2, а multi работает
    // везде и так же не оставляет окна, в котором код можно использовать дважды.
    const [getResult] =
      (await this.redis.multi().get(this.codeKey(code)).del(this.codeKey(code)).exec()) ?? []
    const userId = getResult?.[1] as string | null | undefined
    if (!userId) throw new AppException('BAD_REQUEST', 'Код неверен или истёк')

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, role: true, isBlocked: true, twoFactorEnabled: true },
    })
    if (!user || user.isBlocked || !ALLOWED_ROLES.includes(user.role as Role)) {
      throw this.denied(`link: роль ${user?.role ?? 'нет пользователя'}`)
    }

    const telegramId = verified.user.id
    const existing = await this.prisma.telegramAccount.findUnique({ where: { telegramId } })
    if (existing && existing.userId !== userId && !existing.revokedAt) {
      // Молчаливая перепривязка означала бы, что доступ администратора переехал на другой
      // телефон незаметно для него самого.
      throw new AppException('CONFLICT', 'Этот Telegram уже привязан к другому аккаунту')
    }

    await this.prisma.telegramAccount.upsert({
      where: { userId },
      create: { userId, telegramId, username: verified.user.username ?? null },
      update: {
        telegramId,
        username: verified.user.username ?? null,
        revokedAt: null,
        linkedAt: new Date(),
      },
    })

    await this.audit.record({
      userId,
      action: 'telegram.linked',
      entity: 'TelegramAccount',
      entityId: userId,
      metadata: { source: 'telegram' },
    })

    return this.issueSession({
      id: user.id,
      firstName: user.firstName,
      role: user.role as Role,
      twoFactorEnabled: user.twoFactorEnabled,
    })
  }

  /**
   * Сессия при каждом открытии мини-аппа. Любой отказ — одинаковый 401 без подробностей:
   * по разнице ответов «нет привязки» и «не та роль» вычисляется, кто из админов привязан.
   * Причина уходит в лог.
   */
  async session(initData: string): Promise<MiniSession> {
    const verified = verifyInitData(initData, this.botToken())
    if (!verified.ok) throw this.denied(`session: ${verified.reason}`)

    const account = await this.prisma.telegramAccount.findUnique({
      where: { telegramId: verified.user.id },
      select: {
        id: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            role: true,
            isBlocked: true,
            twoFactorEnabled: true,
          },
        },
      },
    })

    if (!account || account.revokedAt) throw this.denied('session: привязки нет или отозвана')
    const user = account.user
    if (user.isBlocked) throw this.denied('session: пользователь заблокирован')
    if (!ALLOWED_ROLES.includes(user.role as Role)) {
      throw this.denied(`session: роль ${user.role} больше не допущена`)
    }

    // Отметка нужна, чтобы видеть заброшенные привязки и отзывать их. Сбой не должен
    // мешать входу: это статистика, а не условие доступа.
    this.prisma.telegramAccount
      .update({ where: { id: account.id }, data: { lastSeenAt: new Date() } })
      .catch((error: unknown) => this.logger.warn(`lastSeenAt не обновлён: ${String(error)}`))

    return this.issueSession({
      id: user.id,
      firstName: user.firstName,
      role: user.role as Role,
      twoFactorEnabled: user.twoFactorEnabled,
    })
  }

  private issueSession(user: {
    id: string
    firstName: string
    role: Role
    twoFactorEnabled: boolean
  }): MiniSession {
    // Признак `client` отличает токен мини-аппа от обычного access-токена: с ним
    // MiniAppGuard пускает только на маршруты из белого списка (§4).
    //
    // `tfa` обязателен, хотя мини-апп второй фактор не спрашивает. Глобальный
    // TwoFactorGuard отдаёт 403 любой привилегированной роли без этого признака, а
    // платформенные роли привилегированные все — без него мини-апп получал бы отказ на
    // каждом рабочем запросе, выдав перед этим рабочую сессию (`/mini/session` публичный,
    // пользователя в запросе ещё нет, и guard до него не доходит).
    //
    // Значение берётся из БД, а не ставится в `true`: признак означает «у человека
    // включена 2FA», и врать в нём нельзя. Администратор, у которого её нет, получит тот
    // же отказ, что и в вебе, — это и есть задуманное поведение.
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      universityId: null,
      facultyId: null,
      groupId: null,
      client: 'mini',
      tfa: user.twoFactorEnabled,
    }

    return {
      token: this.jwt.sign(payload, { expiresIn: SESSION_TTL_SEC }),
      expiresIn: SESSION_TTL_SEC,
      user: { id: user.id, firstName: user.firstName, role: user.role },
    }
  }

  private denied(reason: string): AppException {
    this.logger.warn(`Мини-апп: отказ — ${reason}`)
    return new AppException('UNAUTHORIZED', 'Нет доступа')
  }

  private codeKey(code: string): string {
    return `mini:link:${code.toUpperCase()}`
  }
}
