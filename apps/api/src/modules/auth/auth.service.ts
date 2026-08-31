import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { PasswordService } from '../../common/security/password.service'
import { AppException } from '../../common/exceptions/app.exception'
import type { EnvVars } from '../../config/env.schema'
import type { JwtPayload } from '../../common/auth/jwt-payload.type'
import { UserService, type UserProfile } from '../users/users.service'
import { InviteService } from '../invites/invites.service'
import { TwoFactorService } from './two-factor.service'
import { parseDurationMs } from './auth.constants'

type PrismaClientLike = PrismaService | Prisma.TransactionClient

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
  ) {}

  /** Проверка идентификатор (email/username) + пароль для LocalStrategy. Не раскрывает, что именно неверно. */
  async validateUser(identifier: string, password: string): Promise<JwtPayload> {
    const user = await this.users.findByLoginIdentifierForAuth(identifier)
    const passwordOk = user ? await this.passwords.compare(password, user.passwordHash) : false
    if (!user || !passwordOk) {
      throw new AppException('UNAUTHORIZED', 'Неверный email или пароль')
    }
    if (user.isBlocked) {
      throw new AppException('FORBIDDEN', 'Учётная запись заблокирована')
    }
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
    },
    ctx: RequestContext,
  ): Promise<SessionResult> {
    const passwordHash = await this.passwords.hash(input.password)

    const user = await this.prisma.$transaction(async (tx) => {
      const invite = await this.invites.claimInvite(tx, input.token)
      const email = invite.email ?? input.email
      if (!email) {
        throw new AppException('BAD_REQUEST', 'Для регистрации нужен email')
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
      })
      await this.invites.markUsed(tx, invite.id, created.sub)
      return created
    })

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
    const userId = this.verifyTwoFactorChallenge(challengeToken)
    const rec = await this.users.getTwoFactorForLogin(userId)
    if (!rec || !rec.twoFactorEnabled) {
      throw new AppException('UNAUTHORIZED', 'Сессия входа недействительна')
    }
    if (rec.isBlocked) {
      throw new AppException('FORBIDDEN', 'Учётная запись заблокирована')
    }
    const ok = await this.twoFactor.verifyCode(rec, code)
    if (!ok) {
      throw new AppException('INVALID_2FA_CODE', 'Неверный код')
    }
    const session = await this.issueSession(this.toPayload(rec), randomUUID())
    await this.audit.record({ userId, action: 'login', ...ctx })
    return session
  }

  // Короткоживущий (5 мин) промежуточный токен между шагом 1 и 2. Подписан access-секретом,
  // но помечен typ='TWO_FACTOR' — JwtStrategy отвергает такие как access-токены.
  private signTwoFactorChallenge(userId: string): string {
    return this.jwt.sign({ sub: userId, typ: 'TWO_FACTOR' }, { expiresIn: '5m' })
  }

  private verifyTwoFactorChallenge(token: string): string {
    try {
      const payload = this.jwt.verify<{ sub?: string; typ?: string }>(token)
      if (payload.typ !== 'TWO_FACTOR' || !payload.sub) {
        throw new Error('invalid challenge')
      }
      return payload.sub
    } catch {
      throw new AppException('UNAUTHORIZED', 'Сессия входа истекла — войдите заново')
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

    // Повторное использование инвалидированного токена → рвём всю цепочку (§6.2).
    //
    // Кроме окна грации: повтор ТОЛЬКО ЧТО ротированного токена, когда цепочка ещё жива, — это,
    // как правило, не кража, а недоставленный ответ. Браузер обрывает запрос при навигации,
    // закрытии вкладки или выгрузке страницы на мобильном: сервер ротацию выполнил, а новая cookie
    // до клиента не доехала, и он честно повторяет обмен старым токеном. Рвать за это сессию
    // значит выкидывать пользователя на ровном месте. В окне выдаём новую ротацию в той же цепочке,
    // оставляя ровно один живой токен. Ширина окна — REFRESH_REUSE_GRACE_MS (0 отключает).
    const reuseInGrace = await this.withinReuseGrace(record)
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

    const secretOk = await this.passwords.compare(parsed.secret, record.tokenHash)
    if (!secretOk) {
      throw new AppException('UNAUTHORIZED', 'Некорректный refresh-токен')
    }

    const user = await this.users.findByIdForAuth(record.userId)
    if (!user || user.isBlocked) {
      await this.revokeFamily(record.familyId)
      throw new AppException('UNAUTHORIZED', 'Учётная запись недоступна')
    }

    // Ротация атомарно: старый revoked + новый в той же цепочке. Гасим и остальные живые токены
    // цепочки — на пути грации там остаётся успешно выданный ранее «преемник», а инвариант
    // «один активный токен на цепочку» терять нельзя.
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } })
      return this.issueSession(this.toPayload(user), record.familyId, tx)
    })

    await this.audit.record({ userId: user.id, action: 'refresh', ...ctx })
    return session
  }

  /** Logout: инвалидирует всю цепочку текущей сессии. */
  async logout(rawToken: string | undefined, ctx: RequestContext): Promise<void> {
    const parsed = this.parseRawToken(rawToken)
    if (!parsed) {
      return
    }
    const record = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } })
    if (!record) {
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
    const tokenHash = await this.passwords.hash(secret)
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
