import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type Redis from 'ioredis'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { PasswordService } from '../../common/security/password.service'
import { equalsConstantTime } from '../../common/security/constant-time'
import { RealtimeGateway } from '../../common/realtime'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { SessionRevocationService } from '../../common/redis/session-revocation.service'
import { AppException } from '../../common/exceptions/app.exception'
import { isAdult, LEGAL_VERSION } from '@studenthub/shared-schemas'
import { Role } from '@studenthub/shared-types'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { UserService, type UserProfile } from '../users/users.service'
import { InviteService } from '../invites/invites.service'
import { UniversityAccessService } from '../universities/university-access.service'
import { TwoFactorService } from './two-factor.service'
import { LoginAttemptsService } from './login-attempts.service'
import { parseDurationMs } from './auth.constants'

type PrismaClientLike = PrismaService | Prisma.TransactionClient

// Время жизни промежуточного токена 2FA. Двумя формами: одна для jwt.sign, вторая для
// TTL пометки в Redis — они обязаны совпадать, иначе пометка переживёт токен или наоборот.
const TWO_FACTOR_CHALLENGE_TTL = '5m'
const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * 60
// Сколько неверных кодов принимает ОДИН challenge, прежде чем сгореть. Три — запас на
// опечатку и на рассинхрон часов (TOTP принимает соседнее окно), но не на перебор:
// шанс угадать шестизначный код за три попытки — три на миллион.
const TWO_FACTOR_MAX_ATTEMPTS = 3

// Секрет refresh хранится в БД как SHA-256, а не bcrypt. Секрет — `randomUUID()`, 122 бита
// случайности: перебирать там нечего, и медленный хэш ничего не защищал, зато каждый обмен
// стоил два bcrypt cost 12 (сверка старого, хэш нового) — ~0,5 с работы пула libuv, куда ходят
// и вход по паролю, и fs, и zlib. Тот же выбор уже сделан для инвайтов, ссылок сброса пароля
// и QR-входа.
//
// Переходный период: токены, выданные до перехода, лежат bcrypt-хэшем (`$2a$`/`$2b$`…) и
// сверяются bcrypt, пока живут, — иначе разлогинились бы все разом. Первый же refresh такой
// сессии выдаёт преемника уже с SHA-256. Refresh живёт 30 дней (JWT_REFRESH_EXPIRES_IN), так
// что через месяц после выката bcrypt-ветку нужно убрать — вместе с этим комментарием.
const LEGACY_BCRYPT_HASH_PREFIX = '$2'

function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export interface RequestContext {
  ip?: string
  userAgent?: string
}

export interface SessionResult {
  accessToken: string
  /** Сырой refresh в формате `<id>.<secret>` — уходит только в httpOnly cookie. */
  refreshToken: string
  refreshExpiresAt: Date
  payload: JwtPayload
}

// Первый шаг входа при включённой 2FA: вместо сессии — короткоживущий challenge.
export interface TwoFactorChallenge {
  twoFactorRequired: true
  challengeToken: string
}

export type LoginResult = SessionResult | TwoFactorChallenge

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  // AuthModule владеет только RefreshToken. Доступ к User — через UserService,
  // к Invite — через InviteService (§2.1). forwardRef(UserService) — разрешённое кольцо.
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    @Inject(forwardRef(() => UserService)) private readonly users: UserService,
    private readonly invites: InviteService,
    private readonly twoFactor: TwoFactorService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly realtime: RealtimeGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly revocation: SessionRevocationService,
    private readonly universityAccess: UniversityAccessService,
  ) {}

  /** Проверка идентификатор (email/username) + пароль для LocalStrategy. Не раскрывает, что именно неверно. */
  async validateUser(identifier: string, password: string): Promise<JwtPayload> {
    // До сверки пароля: серия неудач по этому логину закрывает вход независимо от того,
    // с какого адреса пришла следующая попытка (login-attempts.service.ts — зачем).
    await this.loginAttempts.assertNotLocked(identifier)

    const user = await this.users.findByLoginIdentifierForAuth(identifier)
    // Несуществующий пользователь тоже стоит одного bcrypt: без холостого сравнения ответ
    // приходит на ~250 мс быстрее, и по времени перебирается, какие адреса и логины на
    // платформе заведены. Сообщение об ошибке одинаковое — время должно быть таким же.
    const passwordOk = user
      ? await this.passwords.compare(password, user.passwordHash)
      : await this.passwords.compareWithDummy(password)
    if (!user || !passwordOk) {
      await this.loginAttempts.registerFailure(identifier)
      throw new AppException('UNAUTHORIZED', 'Неверный email или пароль')
    }
    // Пароль верный — серия прервана, даже если аккаунт заблокирован администратором:
    // счётчик про подбор пароля, а не про право входа.
    await this.loginAttempts.reset(identifier)
    if (user.isBlocked) {
      throw new AppException('FORBIDDEN', 'Учётная запись заблокирована')
    }
    // Вуз заблокирован платформой — отказ. После сверки пароля: статус вуза не должен
    // узнаваться перебором чужих логинов.
    await this.universityAccess.assertAllowed(user)
    return this.toPayload(user)
  }

  /**
   * Регистрация по инвайту (docs/PROJECT.md §7.3). Роль и scope берутся ТОЛЬКО из инвайта.
   * Одна транзакция: атомарный claim инвайта (защита от двойного клика) + создание User.
   * После — авто-вход (сессия).
   */
  async registerByInvite(
    input: {
      token: string
      username: string
      firstName: string
      lastName: string
      password: string
      email?: string
      birthDate: string
      consent: true
      guardianConsent?: boolean
    },
    ctx: RequestContext,
  ): Promise<SessionResult> {
    // Возраст пересчитываем на сервере, хотя схема это уже проверила: клиент можно обойти,
    // а основание обработки персональных данных несовершеннолетнего — не то место, где
    // достаточно доверия к форме. Согласие за лицо младше 18 лет даёт законный
    // представитель, и без его отметки регистрация не проходит.
    const minor = !isAdult(input.birthDate)
    if (minor && input.guardianConsent !== true) {
      throw new AppException('BAD_REQUEST', 'Нужно согласие законного представителя')
    }
    const passwordHash = await this.passwords.hash(input.password)

    const { user, starosta } = await this.prisma.$transaction(async (tx) => {
      const invite = await this.invites.claimInvite(tx, input.token)
      // Вуз из инвайта заблокирован — отказ откатывает и захват инвайта: ссылка остаётся
      // действительной до разблокировки.
      await this.universityAccess.assertAllowed(invite)
      // Нижний регистр — и для адреса из инвайта: выданные до нормализации хранят его как
      // пришёл («Ivanov@Uni.kz»), а email сравнивается на платформе без учёта регистра.
      const email = (invite.email ?? input.email)?.trim().toLowerCase()
      if (!email) {
        throw new AppException('BAD_REQUEST', 'Для регистрации нужен email')
      }
      // Уникальный индекс email различает регистр: учётку, заведённую до нормализации как
      // «Ivanov@Uni.kz», он от «ivanov@uni.kz» не защищает — вторая учётка того же человека.
      if (await this.users.findEmailOwnerId(email)) {
        throw new AppException('CONFLICT', 'Пользователь с таким email уже существует')
      }
      const created = await this.users.createInvitedUser(tx, {
        email,
        username: input.username,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: invite.role,
        universityId: invite.universityId,
        facultyId: invite.facultyId,
        groupId: invite.groupId,
        birthDate: new Date(`${input.birthDate}T00:00:00Z`),
        // Что подписали и когда — вместе с самим фактом: редакция документов меняется, а
        // согласие остаётся привязанным к той, которую человек видел.
        consentAt: new Date(),
        consentVersion: LEGAL_VERSION,
        consentByGuardian: minor,
      })
      await this.invites.markUsed(tx, invite.id, created.sub)
      // Инвайт старосты ставит его старостой своей группы — той же транзакцией, что и
      // назначение деканом: отметка в группе и единственная старостинская роль в ней.
      // Без этого в группе со старостой их становилось два, а `Group.starostaId` указывал
      // на прежнего; права старосты были у обоих, пока декан не переназначит руками.
      const starosta =
        invite.role === Role.STAROSTA && invite.groupId
          ? {
              groupId: invite.groupId,
              issuerId: invite.createdById,
              demoted: await this.users.assignInvitedStarosta(tx, invite.groupId, created.sub),
            }
          : null
      return { user: created, starosta }
    })

    if (starosta) {
      // Разжалованным — гашение сессий и аудит смены роли; решение принял выдавший инвайт.
      await this.users.afterStarostaChange(
        starosta.issuerId,
        starosta.groupId,
        null,
        starosta.demoted,
      )
    }

    await this.audit.record({
      userId: user.sub,
      action: 'register_by_invite',
      entity: 'User',
      entityId: user.sub,
      ...ctx,
    })

    // Авто-вход после регистрации → редирект на ROLE_HOME (§7.3, шаг 6).
    const session = await this.issueSession(user, randomUUID())
    await this.audit.record({ userId: user.sub, action: 'login', ...ctx })
    return session
  }

  /**
   * Логин: если у пользователя включена 2FA — вместо сессии возвращаем challenge
   * (токены НЕ выдаются, куки НЕ ставятся). Иначе — новая сессионная цепочка + аудит.
   */
  async login(payload: JwtPayload, ctx: RequestContext): Promise<LoginResult> {
    if (await this.users.isTwoFactorEnabled(payload.sub)) {
      return { twoFactorRequired: true, challengeToken: this.signTwoFactorChallenge(payload.sub) }
    }
    const session = await this.issueSession(payload, randomUUID())
    await this.audit.record({ userId: payload.sub, action: 'login', ...ctx })
    return session
  }

  /**
   * Выдать сессию пользователю по id, без пароля. Используется входом по QR: телефон
   * (уже авторизован, в т.ч. прошёл 2FA) подтвердил вход, поэтому пароль/2FA повторно не нужны.
   */
  async issueSessionForUser(userId: string, ctx: RequestContext): Promise<SessionResult> {
    const user = await this.users.findByIdForAuth(userId)
    if (!user) {
      throw new AppException('UNAUTHORIZED', 'Пользователь не найден')
    }
    if (user.isBlocked) {
      throw new AppException('FORBIDDEN', 'Учётная запись заблокирована')
    }
    await this.universityAccess.assertAllowed(user)
    const session = await this.issueSession(this.toPayload(user), randomUUID())
    await this.audit.record({ userId, action: 'login', ...ctx })
    return session
  }

  /**
   * Второй шаг входа: проверяет challenge-токен и код (TOTP или backup),
   * затем выдаёт полноценную сессию. Пароль уже проверен на первом шаге.
   */
  async loginVerifyTwoFactor(
    challengeToken: string,
    code: string,
    ctx: RequestContext,
  ): Promise<SessionResult> {
    const { userId, jti } = this.verifyTwoFactorChallenge(challengeToken)
    // Сгоревший (три промаха) или уже обменянный challenge — отказ ДО проверки кода. Иначе
    // верный backup-код списывался навсегда, а вход всё равно отвечал «уже использован»,
    // и сгоревший challenge служил оракулом «код верен» без всякого счётчика.
    await this.assertChallengeUnused(jti)
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec || !rec.twoFactorEnabled) {
      throw new AppException('UNAUTHORIZED', 'Сессия входа недействительна')
    }
    if (rec.isBlocked) {
      throw new AppException('FORBIDDEN', 'Учётная запись заблокирована')
    }
    // Первый шаг вуз уже проверил, но между шагами до пяти минут — блокировка могла успеть.
    await this.universityAccess.assertAllowed(rec)
    const consume = await this.twoFactor.checkCode(rec, code)
    if (!consume) {
      // Опечатка в шестизначном коде дело обычное, и сжигать за неё весь вход незачем —
      // но и бесконечно принимать коды по одному challenge нельзя: 6 цифр перебираются,
      // а throttle на эндпоинте считает по IP и обходится их сменой. Отсюда счётчик на
      // сам challenge: несколько попыток на один ввод пароля, дальше — заново.
      await this.countFailedTwoFactorAttempt(jti)
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    // Гасим challenge ИМЕННО здесь — после верного кода, а не до проверки.
    await this.consumeChallengeId(jti)
    // Backup-код списывается только после того, как challenge погашен ЭТИМ запросом: при
    // гонке двух обменов одного challenge код теряет лишь тот, кто получит сессию. Не
    // списался — тот же код только что ушёл параллельным входом.
    if (!(await consume())) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    const session = await this.issueSession(this.toPayload(rec), randomUUID())
    await this.audit.record({ userId, action: 'login', ...ctx })
    return session
  }

  // Короткоживущий (5 мин) промежуточный токен между шагом 1 и 2. Подписан access-секретом,
  // но помечен typ='TWO_FACTOR' — JwtStrategy и RealtimeGateway отвергают такие как access-токены.
  // jti нужен, чтобы токен был ОДНОРАЗОВЫМ: см. verifyTwoFactorChallenge.
  private signTwoFactorChallenge(userId: string): string {
    return this.jwt.sign(
      { sub: userId, typ: 'TWO_FACTOR', jti: randomUUID() },
      { expiresIn: TWO_FACTOR_CHALLENGE_TTL },
    )
  }

  private verifyTwoFactorChallenge(token: string): { userId: string; jti?: string } {
    try {
      const payload = this.jwt.verify<{ sub?: string; typ?: string; jti?: string }>(token)
      if (payload.typ !== 'TWO_FACTOR' || !payload.sub) {
        throw new Error('invalid challenge')
      }
      return { userId: payload.sub, jti: payload.jti }
    } catch {
      throw new AppException('UNAUTHORIZED', 'Сессия входа истекла — войдите заново')
    }
  }

  /**
   * Challenge ещё не обменян и не сгорел. Та же пометка `2fa:challenge:<jti>`, что ставят
   * `consumeChallengeId` и `countFailedTwoFactorAttempt`. Гонку не закрывает (её закрывает
   * SET NX при обмене), но код по мёртвому challenge больше не проверяется и не тратится.
   * Redis недоступен — пропускаем, как и остальные проверки challenge.
   */
  private async assertChallengeUnused(jti: string | undefined): Promise<void> {
    if (!jti) return
    let used: number
    try {
      used = await this.redis.exists(`2fa:challenge:${jti}`)
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis недоступен — состояние challenge 2FA не проверено')
      return
    }
    if (used > 0) {
      throw new AppException('UNAUTHORIZED', 'Этот код входа уже использован — войдите заново')
    }
  }

  /**
   * Гасит jti challenge-токена: один токен — один обмен на сессию.
   *
   * Без этого токен оставался действительным все пять минут и его можно было обменять
   * на сессию повторно — например, из перехваченного ответа первого шага или из истории
   * запросов. Пометка ставится через SET NX: гонка двух параллельных обменов разрешается
   * в Redis, а не в коде.
   *
   * Redis недоступен — пропускаем проверку с предупреждением: ронять вход по второму
   * фактору из-за сбоя кэша нельзя, а пароль на первом шаге уже проверен.
   */
  private async consumeChallengeId(jti: string | undefined): Promise<void> {
    // Токен, выданный до появления jti (обновление на лету), — пропускаем: за пять минут
    // все такие истекут сами.
    if (!jti) return
    let fresh: 'OK' | null
    try {
      fresh = await this.redis.set(
        `2fa:challenge:${jti}`,
        '1',
        'EX',
        TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        'NX',
      )
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Redis недоступен — одноразовость challenge-токена 2FA не проверена',
      )
      return
    }
    if (fresh === null) {
      throw new AppException('UNAUTHORIZED', 'Этот код входа уже использован — войдите заново')
    }
  }

  /**
   * Учесть неверный код 2FA по конкретному challenge и сжечь его, когда попытки кончились.
   *
   * Счётчик именно на challenge, а не на пользователя: привязка к аккаунту дала бы тому,
   * кто знает пароль, способ запереть чужой вход навсегда — достаточно раз за разом
   * вводить неверный код. Здесь же цена промахов — повторный ввод пароля, то есть новый
   * challenge, а первый шаг уже ограничен throttle'ом.
   *
   * Сгоревший challenge гасится тем же ключом, что и использованный (`2fa:challenge:<jti>`),
   * поэтому следующая попытка с ним получит «этот код входа уже использован».
   */
  private async countFailedTwoFactorAttempt(jti: string | undefined): Promise<void> {
    if (!jti) return
    try {
      const attempts = await this.redis.incr(`2fa:attempts:${jti}`)
      if (attempts === 1) {
        await this.redis.expire(`2fa:attempts:${jti}`, TWO_FACTOR_CHALLENGE_TTL_SECONDS)
      }
      if (attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
        await this.redis.set(
          `2fa:challenge:${jti}`,
          '1',
          'EX',
          TWO_FACTOR_CHALLENGE_TTL_SECONDS,
          'NX',
        )
        this.logger.warn('Challenge 2FA сожжён: исчерпаны попытки ввода кода')
      }
    } catch (error) {
      // Тот же принцип, что и у одноразовости challenge: сбой кэша не ломает вход.
      this.logger.warn({ err: error }, 'Redis недоступен — попытки ввода кода 2FA не считаются')
    }
  }

  /** Ротация refresh: инвалидация старого + новый в той же цепочке. Повтор revoked → рвём цепочку. */
  async refresh(rawToken: string | undefined, ctx: RequestContext): Promise<SessionResult> {
    const parsed = this.parseRawToken(rawToken)
    if (!parsed) {
      throw new AppException('UNAUTHORIZED', 'Некорректный refresh-токен')
    }

    const record = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } })
    if (!record) {
      throw new AppException('UNAUTHORIZED', 'Сессия не найдена')
    }

    // Попал ли повтор в окно грации — решаем по моменту прихода запроса, до сверки секрета:
    // сверка старых bcrypt-записей занимает сотни миллисекунд, и, считай мы окно после неё,
    // честный повтор мог вылететь за окно только из-за собственной проверки.
    const reuseInGrace = await this.withinReuseGrace(record)

    // Секрет — до детектора повтора: иначе одного id (без секрета) хватало, чтобы объявить
    // «повтор» и погасить чужую цепочку сессий.
    const secretOk = await this.refreshSecretMatches(parsed.secret, record.tokenHash)
    if (!secretOk) {
      throw new AppException('UNAUTHORIZED', 'Некорректный refresh-токен')
    }

    // Повторное использование инвалидированного токена → рвём всю цепочку (§6.2).
    //
    // Кроме окна грации: повтор ТОЛЬКО ЧТО ротированного токена, когда цепочка ещё жива, — это,
    // как правило, не кража, а недоставленный ответ. Браузер обрывает запрос при навигации,
    // закрытии вкладки или выгрузке страницы на мобильном: сервер ротацию выполнил, а новая cookie
    // до клиента не доехала, и он честно повторяет обмен старым токеном. Рвать за это сессию
    // значит выкидывать пользователя на ровном месте. В окне выдаём новую ротацию в той же цепочке,
    // оставляя ровно один живой токен. Ширина окна — REFRESH_REUSE_GRACE_MS (0 отключает).
    if (record.revokedAt && !reuseInGrace) {
      await this.revokeFamily(record.familyId)
      await this.audit.record({
        userId: record.userId,
        action: 'refresh_reuse_detected',
        entity: 'RefreshToken',
        entityId: record.id,
        ...ctx,
      })
      this.logger.warn(
        { userId: record.userId, familyId: record.familyId },
        'Повторное использование refresh-токена — цепочка инвалидирована',
      )
      throw new AppException('UNAUTHORIZED', 'Сессия скомпрометирована, войдите заново')
    }

    if (reuseInGrace) {
      // Не инцидент, но и не норма: частые попадания сюда означают, что клиент теряет ответы.
      this.logger.debug(
        { userId: record.userId, familyId: record.familyId },
        'Повтор только что ротированного токена в окне грации — выдаём новую ротацию',
      )
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppException('UNAUTHORIZED', 'Сессия истекла')
    }

    const user = await this.users.findByIdForAuth(record.userId)
    if (!user || user.isBlocked) {
      await this.revokeFamily(record.familyId)
      throw new AppException('UNAUTHORIZED', 'Учётная запись недоступна')
    }
    // Вуз заблокирован — новую сессию не выдаём, но и цепочку не гасим: решение платформы
    // обратимо, и после разблокировки сессия продолжается без нового входа.
    await this.universityAccess.assertAllowed(user)

    // Ротация атомарно: старый revoked + новый в той же цепочке. Гасим и остальные живые токены
    // цепочки — на пути грации там остаётся успешно выданный ранее «преемник», а инвариант
    // «один активный токен на цепочку» терять нельзя.
    //
    // В AuditLog обычный обмен не пишется: активная вкладка меняет токен каждые 15 минут, и
    // журнал на 90% состоял из «refresh», вытесняя то, ради чего его читают. Значимые события
    // сессии — вход, выход и повтор погашенного токена — пишутся по-прежнему.
    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } })
      return this.issueSession(this.toPayload(user), record.familyId, tx)
    })
  }

  /** Logout: инвалидирует всю цепочку текущей сессии. */
  async logout(rawToken: string | undefined, ctx: RequestContext): Promise<void> {
    const parsed = this.parseRawToken(rawToken)
    if (!parsed) {
      return
    }
    const record = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } })
    // Без верного секрета выход ничего не гасит: id токена сам по себе не доказывает, что
    // это та же сессия.
    if (!record || !(await this.refreshSecretMatches(parsed.secret, record.tokenHash))) {
      return
    }
    await this.revokeFamily(record.familyId)
    await this.audit.record({ userId: record.userId, action: 'logout', ...ctx })
  }

  /** Профиль текущего пользователя (делегирует UserService). */
  getMe(userId: string): Promise<UserProfile> {
    return this.users.findById(userId)
  }

  /** Гасит ВСЕ активные сессии пользователя. Вызывается UserService при смене пароля/блокировке/удалении. */
  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    // Уже выданные access-токены тоже: без метки отзыва заблокированный ещё до 15 минут
    // ходил в API и переподключал WS тем же токеном (JwtStrategy и gateway её проверяют).
    await this.revocation.revokeIssuedBefore(userId)
    // Открытый WS живёт сам по себе: рвём соединения сразу, переподключиться старым
    // токеном не даст метка отзыва.
    this.realtime.disconnectUser(userId)
  }

  // --- приватные ---

  /**
   * Попадает ли повтор в окно грации: токен ротирован только что И цепочка ещё жива (есть активный
   * преемник). Если активных токенов не осталось, повтор пришёл уже после разрыва — это настоящий
   * инцидент, и обрабатывать его надо строго.
   */
  private async withinReuseGrace(record: {
    revokedAt: Date | null
    familyId: string
  }): Promise<boolean> {
    const graceMs = this.config.get('REFRESH_REUSE_GRACE_MS', { infer: true })
    if (!record.revokedAt || graceMs <= 0) return false
    if (Date.now() - record.revokedAt.getTime() > graceMs) return false
    const alive = await this.prisma.refreshToken.count({
      where: { familyId: record.familyId, revokedAt: null },
    })
    return alive > 0
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }

  private async issueSession(
    payload: JwtPayload,
    familyId: string,
    client: PrismaClientLike = this.prisma,
  ): Promise<SessionResult> {
    const accessToken = this.jwt.sign(payload)

    const secret = randomUUID()
    const tokenHash = hashRefreshSecret(secret)
    const ttlMs = parseDurationMs(this.config.get('JWT_REFRESH_EXPIRES_IN', { infer: true }))
    const refreshExpiresAt = new Date(Date.now() + ttlMs)

    const record = await client.refreshToken.create({
      data: { userId: payload.sub, familyId, tokenHash, expiresAt: refreshExpiresAt },
      select: { id: true },
    })

    return {
      accessToken,
      refreshToken: `${record.id}.${secret}`,
      refreshExpiresAt,
      payload,
    }
  }

  /**
   * Сверка секрета refresh с хэшем из БД. SHA-256 сравнивается за постоянное время; записи,
   * выданные до перехода с bcrypt, — bcrypt'ом (переходная ветка, см. LEGACY_BCRYPT_HASH_PREFIX).
   */
  private async refreshSecretMatches(secret: string, tokenHash: string): Promise<boolean> {
    if (tokenHash.startsWith(LEGACY_BCRYPT_HASH_PREFIX)) {
      return this.passwords.compare(secret, tokenHash)
    }
    return equalsConstantTime(hashRefreshSecret(secret), tokenHash)
  }

  private parseRawToken(raw: string | undefined): { id: string; secret: string } | null {
    if (!raw) {
      return null
    }
    const dot = raw.indexOf('.')
    if (dot <= 0 || dot === raw.length - 1) {
      return null
    }
    return { id: raw.slice(0, dot), secret: raw.slice(dot + 1) }
  }

  private toPayload(user: {
    id: string
    role: JwtPayload['role']
    universityId: string | null
    facultyId: string | null
    groupId: string | null
    twoFactorEnabled?: boolean
    companyMembership?: { companyId: string } | null
  }): JwtPayload {
    return {
      sub: user.id,
      role: user.role,
      universityId: user.universityId,
      facultyId: user.facultyId,
      groupId: user.groupId,
      companyId: user.companyMembership?.companyId ?? null,
      // tfa попадает в токен; refresh пересобирает payload из БД, поэтому после
      // включения/отключения 2FA следующая ротация обновит флаг (см. TwoFactorGuard).
      tfa: user.twoFactorEnabled ?? false,
    }
  }
}
