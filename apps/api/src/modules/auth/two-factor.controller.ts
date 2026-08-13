import { Body, Controller, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { TwoFactorExempt } from '../../common/decorators/two-factor-exempt.decorator'
import { TwoFactorService } from './two-factor.service'
import { TwoFactorEnableDto } from './dto/two-factor-enable.dto'
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto'

// Управление 2FA текущего пользователя. JWT-защищено (не @Public): включать/отключать
// 2FA может только уже вошедший пользователь. Второй шаг ВХОДА — в AuthController (@Public).
// @TwoFactorExempt: под форсом 2FA (TwoFactorGuard) именно эти ручки должны быть доступны,
// иначе привилегированная роль не смогла бы настроить 2FA (403 на всё остальное).
@ApiTags('Auth')
@ApiBearerAuth()
@TwoFactorExempt()
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
  enable(@CurrentUser() user: CurrentUserData, @Body() dto: TwoFactorEnableDto) {
    return this.twoFactor.enable(user.sub, dto.code)
  }

  @Post('disable')
  @ApiOperation({ summary: 'Отключить 2FA (нужен действующий TOTP или backup-код)' })
  @ApiResponse({ status: 401, description: 'INVALID_2FA_CODE' })
  async disable(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: TwoFactorDisableDto,
  ): Promise<null> {
    await this.twoFactor.disable(user.sub, dto.code)
    return null
  }
}
