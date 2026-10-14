import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LocalAuthGuard } from '../../common/guards/local-auth.guard'
import type { CurrentUserData, JwtPayload } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import { AuditService } from '../../common/audit/audit.service'
import { AuthService, type RequestContext, type SessionResult } from './auth.service'
import { AUTH_COOKIE_PATH, REFRESH_COOKIE, ROLE_COOKIE } from './auth.constants'
import { RegisterByInviteDto } from './dto/register-by-invite.dto'
import { TwoFactorVerifyDto } from './dto/two-factor-verify.dto'
import { QrApproveDto } from './dto/qr-approve.dto'
import { QrClaimDto } from './dto/qr-claim.dto'
import { QrLoginService } from './qr-login.service'
import { PasswordResetService } from './password-reset.service'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { MaintenanceExempt } from '../../common/decorators'

@ApiTags('Auth')
// Без входа режим техработ не снять: администратор должен уметь войти в остановленную платформу.
@MaintenanceExempt()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name)

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<EnvVars, true>,
    private readonly qrLogin: QrLoginService,
    private readonly audit: AuditService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } }) // §6.3: 5 / 15 мин с IP
  @Post('login')
  @ApiOperation({ summary: 'Вход по email и паролю' })
  async login(
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string } | { twoFactorRequired: true; challengeToken: string }> {
    const result = await this.authService.login(user, this.ctx(req))
    // 2FA включена → отдаём challenge, токены/куки НЕ ставим (второй шаг — /auth/login/2fa).
    if ('twoFactorRequired' in result) {
      return { twoFactorRequired: true, challengeToken: result.challengeToken }
    }
    this.setAuthCookies(reply, result)
    return { accessToken: result.accessToken }
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } }) // §6.3: как /login — брутфорсим код
  @Post('login/2fa')
  @ApiOperation({ summary: 'Второй шаг входа: проверка кода 2FA (TOTP или backup)' })
  async loginVerify(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const session = await this.authService.loginVerifyTwoFactor(
      dto.challengeToken,
      dto.code,
      this.ctx(req),
    )
    this.setAuthCookies(reply, session)
    return { accessToken: session.accessToken }
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // защита от спама генерацией QR
  @Post('qr/create')
  @ApiOperation({ summary: 'Создать QR-сессию входа (десктоп; возвращает QR + claimSecret)' })
  qrCreate(@Req() req: FastifyRequest) {
    return this.qrLogin.create(this.ctx(req))
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('qr/preview')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Кто просит вход по QR: браузер, ОС и сеть устройства (до подтверждения)',
  })
  @ApiResponse({ status: 404, description: 'QR-сессия не найдена, истекла или уже подтверждена' })
  qrPreview(@Body() dto: QrApproveDto) {
    return this.qrLogin.preview(dto.approveToken)
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // подтверждений с телефона не бывает много
  @Post('qr/approve')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Подтвердить вход по QR (с залогиненного устройства)' })
  @ApiResponse({ status: 404, description: 'QR-сессия не найдена или истекла' })
  async qrApprove(
    @CurrentUser() user: JwtPayload,
    @Body() dto: QrApproveDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.qrLogin.approve(dto.approveToken, user.sub)
    // Одобрение входа нового устройства — событие безопасности: фиксируем в аудите
    // (сам approveToken/секрет НЕ логируем).
    await this.audit.record({ userId: user.sub, action: 'qr_approve', ...this.ctx(req) })
    return null
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('qr/claim')
  @ApiOperation({ summary: 'Забрать сессию после подтверждения (десктоп; нужен claimSecret)' })
  async qrClaim(
    @Body() dto: QrClaimDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const userId = await this.qrLogin.claim(dto.qrId, dto.claimSecret)
    const session = await this.authService.issueSessionForUser(userId, this.ctx(req))
    this.setAuthCookies(reply, session)
    return { accessToken: session.accessToken }
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } }) // §6.3: 3 / час с IP
  @Post('register-by-invite')
  @ApiOperation({ summary: 'Регистрация по инвайту (роль и scope — из инвайта)' })
  async registerByInvite(
    @Body() dto: RegisterByInviteDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const session = await this.authService.registerByInvite(dto, this.ctx(req))
    this.setAuthCookies(reply, session)
    return { accessToken: session.accessToken }
  }

  /**
   * «Забыли пароль» (docs/PROJECT.md §7.2). Ответ одинаков для любого адреса — эндпоинт не
   * должен работать проверкой, кто зарегистрирован. Лимит строже входа: каждый вызов
   * отправляет письмо, и без потолка им заваливали бы чужой ящик.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Прислать ссылку для сброса пароля (публично)' })
  @ApiResponse({ status: 202, description: 'Если адрес зарегистрирован — письмо ушло' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: FastifyRequest): null {
    // Не ждём: для существующего адреса работа (транзакция, очередь, аудит) занимает заметно
    // дольше, чем для несуществующего, и по времени ответа было видно, есть ли такой
    // пользователь. Ответ одинаковый и сразу; сбой — только в лог.
    void this.passwordReset
      .requestReset(dto, this.ctx(req))
      .catch((e: unknown) => this.logger.error(`Сброс пароля не запущен: ${String(e)}`))
    return null
  }

  /**
   * Новый пароль по ссылке из письма. Сессию не выдаёт: после сброса гаснут все сессии, и
   * входить человек идёт сам — так новый пароль сразу проверяется на деле, а 2FA, если она
   * включена, не обходится ссылкой из почты.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } }) // как /login: перебор токена
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Задать новый пароль по ссылке из письма (публично)' })
  @ApiResponse({ status: 204, description: 'Пароль изменён, все сессии погашены' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — ссылка недействительна или устарела' })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR — пароль не по политике' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: FastifyRequest): Promise<void> {
    await this.passwordReset.reset(dto, this.ctx(req))
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Ротация refresh-токена (cookie) → новый access' })
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    let session: SessionResult
    try {
      session = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE], this.ctx(req))
    } catch (error) {
      // Сессия невосстановима (токен истёк, погашен реюз-детектором или подделан) — гасим обе
      // cookie, а не только отвечаем 401. Иначе role-cookie переживает мёртвую сессию, и
      // middleware гоняет пользователя с /login обратно на его home, где refresh падает снова:
      // получается бесконечный редирект и до формы входа не добраться (§7.2).
      this.clearAuthCookies(reply)
      throw error
    }
    this.setAuthCookies(reply, session)
    return { accessToken: session.accessToken }
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Выход: инвалидация сессии и очистка cookie' })
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<null> {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE], this.ctx(req))
    this.clearAuthCookies(reply)
    return null
  }

  @Get('me')
  @ApiOperation({ summary: 'Профиль текущего пользователя' })
  me(@CurrentUser() user: CurrentUserData) {
    return this.authService.getMe(user.sub)
  }

  // --- приватные ---

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }

  private isProd(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production'
  }

  private setAuthCookies(reply: FastifyReply, session: SessionResult): void {
    const secure = this.isProd()
    // Refresh — httpOnly, только на auth-пути (§6.2).
    reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: AUTH_COOKIE_PATH,
      expires: session.refreshExpiresAt,
    })
    // role-cookie — нечувствительная, для ролевого редиректа в middleware (§16.2). Не httpOnly.
    const roleValue = Buffer.from(
      JSON.stringify({
        role: session.payload.role,
        universityId: session.payload.universityId,
        facultyId: session.payload.facultyId,
        groupId: session.payload.groupId,
      }),
    ).toString('base64url')
    reply.setCookie(ROLE_COOKIE, roleValue, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: session.refreshExpiresAt,
    })
  }

  private clearAuthCookies(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, { path: AUTH_COOKIE_PATH })
    reply.clearCookie(ROLE_COOKIE, { path: '/' })
  }
}
