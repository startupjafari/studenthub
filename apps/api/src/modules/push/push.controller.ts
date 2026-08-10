import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { PushService } from './push.service'
import { PushSubscribeDto, PushUnsubscribeDto } from './dto/push-subscribe.dto'

// Подписки на Web Push (Ф13.3). Все ручки — под JwtAuthGuard (глобальный).
@ApiTags('Push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('public-key')
  @ApiOperation({ summary: 'Публичный VAPID-ключ для подписки (null — push отключён)' })
  publicKey(): { key: string | null } {
    return { key: this.push.publicKey }
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Сохранить подписку браузера на push' })
  async subscribe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PushSubscribeDto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.push.saveSubscription(user.sub, dto, req.headers['user-agent'])
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить подписку браузера на push' })
  async unsubscribe(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PushUnsubscribeDto,
  ): Promise<void> {
    await this.push.removeSubscription(user.sub, dto.endpoint)
  }
}
