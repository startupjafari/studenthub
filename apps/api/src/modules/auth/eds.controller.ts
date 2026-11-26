import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { RESTRICTED_ROLES } from '@studenthub/shared-types'
import type { EdsChallenge, EdsLinkResult, EdsPublicConfig } from '@studenthub/shared-schemas'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { MaintenanceExempt } from '../../common/decorators'
import { RestrictedAllowed } from '../../common/decorators/restricted-allowed.decorator'
import { AuthThrottle } from '../../common/guards/user-throttler.guard'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { EnvVars } from '../../config/env.schema'
import type { RequestContext } from './auth.service'
import { setAuthCookies } from './auth-cookies'
import { EdsAuthService } from './eds-auth.service'
import { EdsSignedChallengeDto } from './dto/eds-signed-challenge.dto'
import { EdsLinkDto } from './dto/eds-link.dto'
import { EdsUnlinkDto } from './dto/eds-unlink.dto'

const MINUTE = 60_000

/**
 * Вход по ЭЦП НУЦ РК (docs/PROJECT.md §8.3 «Вход по ЭЦП»). Выключенный флаг
 * EDS_LOGIN_ENABLED — `503 FEATURE_DISABLED` на всём, кроме `GET config`: по нему веб и
 * решает, показывать ли кнопку.
 *
 * Публичны только config, challenge и login — то, без чего не войти. Привязка и отвязка —
 * из уже вошедшей сессии и с кодом 2FA.
 */
@ApiTags('Auth')
// Охрана и библиотекарь — роли с обязательной 2FA, им вход по ЭЦП открыт так же, как 2FA.
@RestrictedAllowed(...RESTRICTED_ROLES)
@Controller('auth/eds')
export class EdsController {
  constructor(
    private readonly eds: EdsAuthService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  @Public()
  // Без входа режим техработ не снять: администратор должен уметь войти и по ЭЦП.
  @MaintenanceExempt()
  @Get('config')
  @ApiOperation({ summary: 'Включён ли вход по ЭЦП (публично; показывать ли кнопку)' })
  @ApiResponse({ status: 200, description: '{ enabled }' })
  publicConfig(): EdsPublicConfig {
    return this.eds.publicConfig()
  }

  @Public()
  @MaintenanceExempt()
  // Challenge ничего не стоит базе, но каждый — ключ в Redis на три минуты: как у QR-входа.
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @Post('challenge')
  @ApiOperation({
    summary: 'Challenge для входа по ЭЦП: nonce (base64) подписать ключом аутентификации',
  })
  @ApiResponse({ status: 201, description: '{ challengeId, nonce, expiresAt } — живёт 3 минуты' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT' })
  @ApiResponse({
    status: 503,
    description: 'FEATURE_DISABLED — вход по ЭЦП выключен; EDS_UNAVAILABLE — сбой хранилища',
  })
  challenge(): Promise<EdsChallenge> {
    return this.eds.createLoginChallenge()
  }

  // §6.3: как /login/2fa — свой счётчик и потолок 50 / 15 мин с адреса. Владелец ключа до
  // проверки подписи неизвестен, поэтому свой счётчик — на challenge (user-throttler.guard.ts).
  @Public()
  @MaintenanceExempt()
  @AuthThrottle('eds-login', { limit: 5, ttl: 15 * MINUTE }, { limit: 50, ttl: 15 * MINUTE })
  @Post('login')
  @ApiOperation({
    summary: 'Вход по ЭЦП: подписанный challenge → сессия (без TOTP — ЭЦП сама два фактора)',
  })
  @ApiResponse({ status: 201, description: '{ accessToken } + refresh-cookie' })
  @ApiResponse({
    status: 401,
    description:
      'EDS_SIGNATURE_INVALID (подпись не та, challenge истёк или использован) · EDS_CERT_EXPIRED · EDS_CERT_REVOKED · EDS_CERT_NOT_AUTH · EDS_NOT_LINKED',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — учётка заблокирована; UNIVERSITY_BLOCKED; EMAIL_NOT_VERIFIED',
  })
  @ApiResponse({ status: 422, description: 'VALIDATION_ERROR' })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMIT; LOGIN_LOCKED — серия отказов по этому ключу',
  })
  @ApiResponse({
    status: 503,
    description: 'FEATURE_DISABLED; EDS_UNAVAILABLE — NCANode не ответил, вход по паролю работает',
  })
  async login(
    @Body() dto: EdsSignedChallengeDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const session = await this.eds.login(dto, ctx(req))
    setAuthCookies(reply, session, this.isProd())
    return { accessToken: session.accessToken }
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @Post('link/challenge')
  @ApiOperation({ summary: 'Challenge для привязки ЭЦП к своей учётке (роли с обязательной 2FA)' })
  @ApiResponse({ status: 201, description: '{ challengeId, nonce, expiresAt } — живёт 3 минуты' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — роли вход по ЭЦП недоступен' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED; EDS_UNAVAILABLE' })
  linkChallenge(@CurrentUser() user: CurrentUserData): Promise<EdsChallenge> {
    return this.eds.createLinkChallenge(user)
  }

  @ApiBearerAuth()
  @Post('link')
  @ApiOperation({
    summary:
      'Привязать ЭЦП к своей учётке (подписанный challenge привязки + свой код 2FA); заменяет прежнюю',
  })
  @ApiResponse({
    status: 201,
    description:
      'EdsCredentialInfo + nameMismatch (фамилия в сертификате не совпала с профилем — предупреждение)',
  })
  @ApiResponse({
    status: 401,
    description:
      'INVALID_2FA_CODE · EDS_SIGNATURE_INVALID · EDS_CERT_EXPIRED · EDS_CERT_REVOKED · EDS_CERT_NOT_AUTH',
  })
  @ApiResponse({
    status: 403,
    description: 'FORBIDDEN — роли вход по ЭЦП недоступен; TWO_FACTOR_SETUP_REQUIRED — нет 2FA',
  })
  @ApiResponse({ status: 409, description: 'EDS_ALREADY_LINKED — ИИН привязан к другой учётке' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — слишком много неверных кодов' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED; EDS_UNAVAILABLE' })
  link(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: EdsLinkDto,
    @Req() req: FastifyRequest,
  ): Promise<EdsLinkResult> {
    return this.eds.link(user, dto, ctx(req))
  }

  @ApiBearerAuth()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отвязать свою ЭЦП (свой код 2FA)' })
  @ApiResponse({ status: 204, description: 'Привязка снята' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — ЭЦП не привязана' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — слишком много неверных кодов' })
  @ApiResponse({ status: 503, description: 'FEATURE_DISABLED' })
  async unlink(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: EdsUnlinkDto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.eds.unlink(user.sub, dto.code, ctx(req))
  }

  private isProd(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production'
  }
}

// Адрес и клиент — в журнал аудита рядом с фактом входа или смены способа входа.
function ctx(req: FastifyRequest): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] }
}
