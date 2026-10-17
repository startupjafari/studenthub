import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { TwoFactorExempt } from '../../common/decorators/two-factor-exempt.decorator'
import { TwoFactorService, type TwoFactorRequestContext } from './two-factor.service'
import { TwoFactorEnableDto } from './dto/two-factor-enable.dto'
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto'
import { TwoFactorConfirmDto } from './dto/two-factor-confirm.dto'
import { MaintenanceExempt } from '../../common/decorators'

// Управление 2FA текущего пользователя. JWT-защищено (не @Public): включать/отключать
// 2FA может только уже вошедший пользователь. Второй шаг ВХОДА — в AuthController (@Public).
// @TwoFactorExempt: под форсом 2FA (TwoFactorGuard) именно эти ручки должны быть доступны,
// иначе привилегированная роль не смогла бы настроить 2FA (403 на всё остальное).
@ApiTags('Auth')
@ApiBearerAuth()
@TwoFactorExempt()
// Второй шаг входа — часть входа: без него привилегированная роль в остановленную платформу не попадёт.
@MaintenanceExempt()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  @ApiOperation({ summary: 'Начать настройку 2FA: секрет + QR (otpauth)' })
  @ApiResponse({ status: 201, description: 'QR (data-URL), otpauthUrl и секрет для ручного ввода' })
  @ApiResponse({ status: 409, description: 'CONFLICT — 2FA уже включена' })
  setup(@CurrentUser() user: CurrentUserData) {
    return this.twoFactor.setup(user.sub)
  }

  @Post('enable')
  @ApiOperation({ summary: 'Подтвердить код и включить 2FA (возвращает backup-коды один раз)' })
  @ApiResponse({ status: 201, description: 'backupCodes' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE' })
  enable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TwoFactorEnableDto,
    @Req() req: FastifyRequest,
  ) {
    return this.twoFactor.enable(user.sub, dto.code, ctx(req))
  }

  @Post('backup-codes')
  @ApiOperation({
    summary: 'Перевыпустить backup-коды (нужен действующий TOTP или backup-код; прежние сгорают)',
  })
  @ApiResponse({ status: 201, description: 'backupCodes — показываются один раз' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — 2FA не включена' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE' })
  @ApiResponse({ status: 429, description: 'RATE_LIMIT — слишком много неверных кодов' })
  regenerateBackupCodes(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TwoFactorConfirmDto,
    @Req() req: FastifyRequest,
  ) {
    return this.twoFactor.regenerateBackupCodes(user.sub, dto.code, ctx(req))
  }

  @Post('disable')
  @ApiOperation({ summary: 'Отключить 2FA (нужен действующий TOTP или backup-код)' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE' })
  async disable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TwoFactorDisableDto,
    @Req() req: FastifyRequest,
  ): Promise<null> {
    await this.twoFactor.disable(user.sub, dto.code, ctx(req))
    return null
  }
}

// Адрес и клиент — в журнал аудита рядом с фактом смены второго фактора.
function ctx(req: FastifyRequest): TwoFactorRequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] }
}
