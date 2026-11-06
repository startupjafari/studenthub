import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import type { ForgotPasswordInput, ResetPasswordInput } from '@studenthub/shared-schemas'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AuditService } from '../../common/audit/audit.service'
import { AppException } from '../../common/exceptions/app.exception'
import { EMAIL_JOBS, QUEUES, QueueService } from '../../common/queue'
import type { EnvVars } from '../../config/env.schema'
import { webBaseUrl } from '../../config/web-base'
import { deadlineLabel } from '../../common/time/local-label'
import { UserService } from '../users/users.service'
import { emailDict } from '../email/email-strings'
import { LoginAttemptsService } from './login-attempts.service'
import type { RequestContext } from './auth.service'

/**
 * Срок жизни ссылки. Час, а не сутки, как у подтверждения почты: ссылка даёт войти в чужой
 * аккаунт, и чем дольше она лежит в ящике, тем больше у неё шансов попасть не в те руки.
 * Письмо приходит за секунды — часа хватает с запасом.
 */
const RESET_TTL_MS = 60 * 60 * 1000

/**
 * Сброс пароля по ссылке из письма (docs/PROJECT.md §7.2).
 *
 * AuthModule владеет таблицей токенов, как и RefreshToken; пользователь читается и
 * меняется через UserService (§2.1). Два правила, на которых всё держится:
 * - ответ на «забыли пароль» одинаков для любого адреса — иначе эндпоинт стал бы
 *   проверкой, кто зарегистрирован на платформе;
 * - в БД только SHA-256 токена. Он одноразовый: погашается условным UPDATE, поэтому два
 *   одновременных перехода по одной ссылке не сменят пароль дважды.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly config: ConfigService<EnvVars, true>,
    // forwardRef — разрешённое кольцо Auth ↔ Users (§2.1), как в AuthService.
    @Inject(forwardRef(() => UserService)) private readonly users: UserService,
  ) {}

  async requestReset(input: ForgotPasswordInput, ctx: RequestContext): Promise<void> {
    const user = await this.users.findForPasswordReset(input.email)
    // Заблокированному ссылку не шлём: войти он всё равно не сможет, а письмо «сбросьте
    // пароль» читалось бы как обещание, что сможет.
    if (!user || user.isBlocked) {
      this.logger.log('Сброс пароля: учётной записи для письма нет — ответ-заглушка')
      return
    }

    const rawToken = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + RESET_TTL_MS)
    await this.prisma.$transaction([
      // Новая ссылка гасит прежние: действует только последнее письмо.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
      }),
    ])

    const t = emailDict(user.locale)
    await this.queue.enqueue(
      QUEUES.EMAIL,
      EMAIL_JOBS.SEND_PASSWORD_RESET,
      {
        to: user.email,
        locale: user.locale,
        firstName: user.firstName,
        resetUrl: `${webBaseUrl(this.config)}/reset-password?token=${rawToken}`,
        expiresAt: deadlineLabel(expiresAt, t.dateLocale, user.university?.timezone),
      },
      // jobId — по хэшу, а не по сырому токену: имя задачи живёт в Redis дольше письма.
      { jobId: `password-reset:${hashToken(rawToken)}` },
    )

    await this.audit.record({
      userId: user.id,
      action: 'password_reset_requested',
      entity: 'User',
      entityId: user.id,
      ...ctx,
    })
  }

  async reset(input: ResetPasswordInput, ctx: RequestContext): Promise<void> {
    const tokenHash = hashToken(input.token)
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    })
    // Условное погашение: и проверка срока, и защита от двойного клика — одним UPDATE.
    // Неизвестная, использованная и истёкшая ссылка отвечают одинаково: разбирать, какая
    // именно, пользователю незачем, а разные ответы рассказывали бы о чужих токенах.
    const consumed = record
      ? await this.prisma.passwordResetToken.updateMany({
          where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        })
      : { count: 0 }
    if (!record || consumed.count !== 1) {
      throw new AppException('BAD_REQUEST', 'Ссылка недействительна или устарела')
    }

    await this.users.setPasswordAfterReset(record.userId, input.password)
    // Блокировка входа защищала прежний пароль от подбора; с новым ждать её конца незачем.
    // Подбор считается отдельно по email и по логину — снимаем оба.
    const login = await this.users.loginIdentifiersOf(record.userId)
    if (login) {
      await Promise.all(
        [login.email, ...(login.username ? [login.username] : [])].map((id) =>
          this.loginAttempts.unlock(id),
        ),
      )
    }

    await this.audit.record({
      userId: record.userId,
      action: 'password_reset',
      entity: 'User',
      entityId: record.userId,
      ...ctx,
    })
  }
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
