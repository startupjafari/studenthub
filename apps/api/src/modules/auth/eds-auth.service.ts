import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type Redis from 'ioredis'
import { isTwoFactorRequired } from '@studenthub/shared-types'
import type {
  EdsChallenge,
  EdsLinkInput,
  EdsLinkResult,
  EdsPublicConfig,
  EdsSignedChallengeInput,
} from '@studenthub/shared-schemas'
import { REDIS_CLIENT } from '../../common/redis/redis.constants'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { EdsVerifier, type VerifiedEdsSigner } from '../../common/eds/eds-verifier'
import { QueueService, QUEUES, EMAIL_JOBS } from '../../common/queue'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { UserService, type EdsCertificateSnapshot } from '../users/users.service'
import { AuthService, type RequestContext, type SessionResult } from './auth.service'
import { TwoFactorService } from './two-factor.service'
import { LoginAttemptsService } from './login-attempts.service'

// Challenge живёт три минуты: человеку нужно выбрать файл ключа в NCALayer и ввести пароль к
// нему, а дольше подписанный ответ не должен годиться — перехваченный или застрявший в истории
// запросов, он иначе оставался бы пропуском в учётку.
const CHALLENGE_TTL_SECONDS = 3 * 60
// 256 бит случайности: подобрать или угадать будущий nonce нельзя, подписать «заранее» тоже.
const NONCE_BYTES = 32

function challengeKey(challengeId: string): string {
  return `eds:challenge:${challengeId}`
}

/**
 * Ключ счётчика отказов входа по ЭЦП в LoginAttemptsService — по ИИН (его HMAC), а не по
 * учётке: так он работает одинаково и для непривязанного ключа. Префикс отделяет его от
 * счётчиков пароля и кода 2FA — промахи одним способом входа не закрывают другой.
 */
function edsAttemptKey(iinHash: string): string {
  return `eds:${iinHash}`
}

/** Для чего выдан challenge: подпись для входа не годится для привязки и наоборот. */
type ChallengePurpose = 'login' | 'link'

interface ChallengeState {
  purpose: ChallengePurpose
  /** base64 — ровно то, что ушло клиенту и что он подписал. */
  nonce: string
  /** Только у challenge привязки: чья сессия его запросила. */
  userId?: string
}

/**
 * Вход по ЭЦП НУЦ РК (docs/PROJECT.md §8.3 «Вход по ЭЦП»).
 *
 * Сервер выдаёт одноразовый случайный challenge, клиент подписывает его ключом аутентификации
 * через NCALayer, NCANode проверяет подпись, цепочку до НУЦ, срок, отзыв и назначение ключа
 * (EdsVerifier). Владелец ключа находится по ИИН из сертификата — в базе только HMAC ИИН.
 *
 * ПОЧЕМУ СЕССИЯ БЕЗ TOTP. Подпись ключом аутентификации — уже два фактора: файл ключа
 * (владение) и пароль к нему (знание), причём пароль проверяется локально и на сервер не
 * уходит. Требовать поверх ещё и TOTP значило бы сделать вход по ЭЦП сложнее входа по паролю.
 * Сама 2FA для привилегированных ролей при этом остаётся обязательной: `tfa` в токен идёт из
 * базы, и без включённой 2FA TwoFactorGuard так же отправит настраивать её.
 *
 * ПОЧЕМУ ТОЛЬКО РОЛИ С ОБЯЗАТЕЛЬНОЙ 2FA. Вход по ЭЦП — для сотрудников, у которых ключ НУЦ
 * рабочий инструмент. Студенту второй способ входа — лишняя поверхность атаки без пользы.
 *
 * ЧТО НЕ ЛОГИРУЕТСЯ НИКОГДА: ИИН (ни полный, ни хвост), подпись `cms`, nonce. В журнал и логи
 * идут только id учётки и факт события.
 */
@Injectable()
export class EdsAuthService {
  private readonly logger = new Logger(EdsAuthService.name)

  // Доступ к User и к привязке — через UserService (§2.1); forwardRef — то же разрешённое
  // кольцо Auth ↔ Users, что у AuthService и TwoFactorService.
  constructor(
    private readonly config: ConfigService<EnvVars, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly verifier: EdsVerifier,
    @Inject(forwardRef(() => UserService)) private readonly users: UserService,
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  /** Публичная настройка: показывать ли на странице входа кнопку ЭЦП. */
  publicConfig(): EdsPublicConfig {
    return { enabled: this.enabled() }
  }

  /** Challenge для входа: не привязан ни к кому — кто подписал, станет ясно из подписи. */
  async createLoginChallenge(): Promise<EdsChallenge> {
    this.assertEnabled()
    return this.issueChallenge({ purpose: 'login' })
  }

  /**
   * Challenge для привязки — к сессии того, кто привязывает: подписанный ответ годится только
   * ему. Роль — из токена: охват маршрута решает токен, а link перечитает её из базы.
   */
  async createLinkChallenge(user: JwtPayload): Promise<EdsChallenge> {
    this.assertEnabled()
    if (!isTwoFactorRequired(user.role)) {
      throw new AppException('FORBIDDEN', 'Вход по ЭЦП недоступен для вашей роли')
    }
    return this.issueChallenge({ purpose: 'link', userId: user.sub })
  }

  /**
   * Вход по подписанному challenge. Порядок — от дешёвого к дорогому и так, чтобы ничто не
   * проверялось дважды: challenge гасится первым (одноразовость), подпись проверяет NCANode,
   * затем учётка по ИИН, её роль и допуск (блокировка, вуз, почта работодателя — общий путь
   * AuthService.issueSessionForUser).
   */
  async login(input: EdsSignedChallengeInput, ctx: RequestContext): Promise<SessionResult> {
    this.assertEnabled()
    const state = await this.takeChallenge(input.challengeId)
    if (!state || state.purpose !== 'login') throw invalidSignature()

    const signer = await this.verifier.verifyAuthSignature(
      input.cms,
      Buffer.from(state.nonce, 'base64'),
    )
    const iinHash = this.hashIin(signer.iin)

    // Подбирать здесь нечего — подпись не угадать, пароль к ключу проверяется у человека на
    // компьютере. Счётчик держит другое: один и тот же ключ, раз за разом упирающийся в отказ
    // (не привязан, заблокирован, вуз закрыт), каждый раз стоит запроса к NCANode и OCSP НУЦ.
    // Серия отказов по ИИН закрывает вход по нему с той же нарастающей блокировкой, что у
    // пароля (5 мин → 15 мин → час); успешный вход серию обнуляет.
    const attemptKey = edsAttemptKey(iinHash)
    await this.loginAttempts.beginAttempt(attemptKey)

    const linked = await this.users.findEdsCredentialByIinHash(iinHash)
    if (!linked) throw notLinked()
    // Привязка есть, а роль уже не та: смена роли снимает привязку, но проверка здесь — вторая
    // линия на случай пути смены роли, который об этом забыл. Наружу — тот же ответ, что у
    // непривязанного ключа: роль учётки по ЭЦП не должна узнаваться.
    if (!isTwoFactorRequired(linked.role)) {
      this.logger.warn(
        { userId: linked.userId, role: linked.role },
        'Вход по ЭЦП отклонён: у учётки с привязкой роль без права входа по ЭЦП',
      )
      throw notLinked()
    }

    const session = await this.auth.issueSessionForUser(linked.userId, ctx, 'eds')
    await this.loginAttempts.reset(attemptKey)
    // Ключ мог перевыпуститься (НУЦ делает это ежегодно) — владелец видит актуальный срок.
    await this.users.touchEdsCredential(linked.userId, certificateSnapshot(signer))
    return session
  }

  /**
   * Привязать свою ЭЦП (или перепривязать на другой ИИН). Код 2FA — первым: без него
   * украденная сессия не тратит ни challenge, ни запрос к NCANode, а backup-код списывается
   * последним, когда отказов уже не будет (TwoFactorService.checkWithLimit).
   */
  async link(user: JwtPayload, input: EdsLinkInput, ctx: RequestContext): Promise<EdsLinkResult> {
    this.assertEnabled()
    // Роль и 2FA — из базы, а не из токена: токен живёт 15 минут и мог устареть.
    const rec = await this.users.getTwoFactorForLogin(user.sub)
    if (!rec) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    if (!isTwoFactorRequired(rec.role)) {
      throw new AppException('FORBIDDEN', 'Вход по ЭЦП недоступен для вашей роли')
    }
    if (!rec.twoFactorEnabled) {
      throw new AppException(
        'TWO_FACTOR_SETUP_REQUIRED',
        'Сначала включите двухфакторную аутентификацию — привязка подтверждается её кодом',
      )
    }
    const consume = await this.twoFactor.checkWithLimit(rec, input.code)
    if (!consume) throw new AppException('INVALID_2FA_CODE', 'Неверный код')

    const state = await this.takeChallenge(input.challengeId)
    if (!state || state.purpose !== 'link' || state.userId !== user.sub) throw invalidSignature()

    const signer = await this.verifier.verifyAuthSignature(
      input.cms,
      Buffer.from(state.nonce, 'base64'),
    )
    const iinHash = this.hashIin(signer.iin)
    const holder = await this.users.findEdsCredentialByIinHash(iinHash)
    if (holder && holder.userId !== user.sub) {
      throw new AppException('EDS_ALREADY_LINKED', 'Эта ЭЦП уже привязана к другой учётной записи')
    }

    // Последним — списание backup-кода. Не списался: тот же код только что ушёл параллельным
    // запросом, и привязка по нему не проходит.
    if (!(await consume())) throw new AppException('INVALID_2FA_CODE', 'Неверный код')

    const owner = await this.users.getEdsOwner(user.sub)
    if (!owner) throw new AppException('NOT_FOUND', 'Пользователь не найден')
    const { info, replaced } = await this.users.linkEdsCredential(user.sub, {
      iinHash,
      iinLast4: signer.iin.slice(-4),
      ...certificateSnapshot(signer),
    })
    const nameMismatch = surnameMismatch(signer.subjectCn, owner.lastName)

    // В журнал — только факт и признаки, без ИИН и без данных сертификата: по ним разбирают
    // угон учётки («кто и когда добавил способ входа»), а сам ключ виден в привязке.
    await this.audit.record({
      userId: user.sub,
      action: 'eds_link',
      entity: 'User',
      entityId: user.sub,
      metadata: { replaced, nameMismatch },
      ...ctx,
    })
    // Владелец узнаёт о новом способе входа сразу: если привязывал не он, это угон учётки.
    // jobId с отметкой времени — каждая привязка отдельное письмо.
    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_EDS_LINKED,
      {
        to: owner.email,
        locale: owner.locale,
        firstName: owner.firstName,
        subjectCn: signer.subjectCn,
      },
      { jobId: `eds-linked:${user.sub}:${Date.now()}` },
    )
    return { ...info, nameMismatch }
  }

  /**
   * Отвязать свою ЭЦП (подтверждение — свой код 2FA). Проверка привязки — до кода: тратить
   * backup-код на запрос, который всё равно отклонён, незачем.
   */
  async unlink(userId: string, code: string, ctx: RequestContext): Promise<void> {
    this.assertEnabled()
    if (!(await this.users.hasEdsCredential(userId))) {
      throw new AppException('BAD_REQUEST', 'ЭЦП не привязана')
    }
    if (!(await this.twoFactor.verifyForUser(userId, code))) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    await this.users.removeEdsCredential(userId)
    await this.audit.record({
      userId,
      action: 'eds_unlink',
      entity: 'User',
      entityId: userId,
      ...ctx,
    })
  }

  // --- приватные ---

  private enabled(): boolean {
    return this.config.get('EDS_LOGIN_ENABLED', { infer: true }) === true
  }

  private assertEnabled(): void {
    if (!this.enabled()) {
      throw new AppException('FEATURE_DISABLED', 'Вход по ЭЦП выключен на сервере')
    }
  }

  /**
   * HMAC-SHA256 ИИН с секретом EDS_IIN_PEPPER. Не голый SHA-256: ИИН — 12 цифр с датой
   * рождения и контрольной суммой, перебор всего пространства — минуты, и утёкшая таблица
   * без секрета превращалась бы обратно в список ИИН. Это не токен (BACKEND_RULES §1 про
   * createHmac для токенов), а псевдонимизация ПДн под поиск по точному совпадению.
   */
  private hashIin(iin: string): string {
    const pepper = this.config.get('EDS_IIN_PEPPER', { infer: true })
    // Схема окружения не даёт включить вход без секрета; сюда — только если её обошли.
    if (!pepper) throw new AppException('FEATURE_DISABLED', 'Вход по ЭЦП не настроен на сервере')
    return createHmac('sha256', pepper).update(iin).digest('hex')
  }

  private async issueChallenge(
    scope: { purpose: 'login' } | { purpose: 'link'; userId: string },
  ): Promise<EdsChallenge> {
    const challengeId = randomUUID()
    const nonce = randomBytes(NONCE_BYTES).toString('base64')
    const state: ChallengeState = { ...scope, nonce }
    try {
      await this.redis.set(
        challengeKey(challengeId),
        JSON.stringify(state),
        'EX',
        CHALLENGE_TTL_SECONDS,
      )
    } catch (error) {
      // Без Redis нет одноразовости, а без неё подписанный ответ — многоразовый пропуск.
      // Вход по ЭЦП в это время закрыт; по паролю — работает.
      this.logger.warn({ err: error }, 'Redis недоступен — challenge входа по ЭЦП не выдан')
      throw new AppException('EDS_UNAVAILABLE', 'Вход по ЭЦП временно недоступен')
    }
    return {
      challengeId,
      nonce,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    }
  }

  /**
   * Забрать challenge и сразу погасить — одной транзакцией MULTI (GET + DEL): из двух
   * одновременных запросов с одним challenge значение получит ровно один, второй увидит
   * пустоту. GETDEL есть только с Redis 6.2, MULTI работает везде (как MiniService.link).
   * Гасится при любом исходе дальнейших проверок: подпись, отвергнутая NCANode, второй
   * попытки на том же challenge не получает.
   */
  private async takeChallenge(challengeId: string): Promise<ChallengeState | null> {
    let raw: unknown
    try {
      const key = challengeKey(challengeId)
      const [getResult] = (await this.redis.multi().get(key).del(key).exec()) ?? []
      raw = getResult?.[1]
    } catch (error) {
      this.logger.warn({ err: error }, 'Redis недоступен — challenge входа по ЭЦП не прочитан')
      throw new AppException('EDS_UNAVAILABLE', 'Вход по ЭЦП временно недоступен')
    }
    if (typeof raw !== 'string') return null
    try {
      const parsed = JSON.parse(raw) as Partial<ChallengeState>
      if (typeof parsed.nonce !== 'string') return null
      if (parsed.purpose !== 'login' && parsed.purpose !== 'link') return null
      return { purpose: parsed.purpose, nonce: parsed.nonce, userId: parsed.userId }
    } catch {
      return null
    }
  }
}

function invalidSignature(): AppException {
  return new AppException(
    'EDS_SIGNATURE_INVALID',
    'Подпись недействительна или устарела — подпишите запрос ещё раз',
  )
}

function notLinked(): AppException {
  return new AppException(
    'EDS_NOT_LINKED',
    'Эта ЭЦП не привязана ни к одной учётной записи с входом по ЭЦП',
  )
}

/** Поля сертификата, которые хранятся в привязке. ИИН сюда не входит — только хэш и хвост. */
function certificateSnapshot(signer: VerifiedEdsSigner): EdsCertificateSnapshot {
  return {
    subjectCn: signer.subjectCn,
    orgBin: signer.orgBin,
    certSerial: signer.certSerial,
    certIssuer: signer.certIssuer,
    certNotAfter: signer.certNotAfter,
  }
}

/**
 * Не та фамилия в сертификате? НУЦ РК пишет CN как «ФАМИЛИЯ ИМЯ [ОТЧЕСТВО]» — фамилия первым
 * словом. Сравнение без учёта регистра и различия «ё»/«е»: в профиле их пишут как придётся.
 */
export function surnameMismatch(subjectCn: string, lastName: string): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е')
  const surname = normalize(subjectCn).split(/\s+/)[0] ?? ''
  return surname === '' || surname !== normalize(lastName)
}
