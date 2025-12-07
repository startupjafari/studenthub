import {
  Controller,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from './push.service';

class RegisterDeviceDto {
  fcmToken: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  deviceName?: string;
}

class UnregisterDeviceDto {
  deviceId: string;
}

@ApiTags('Push Notifications')
@Controller('push')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Зарегистрировать устройство для push уведомлений' })
  @ApiResponse({ status: 200, description: 'Устройство зарегистрировано' })
  async registerDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    await this.pushService.registerDevice(userId, dto.fcmToken, {
      platform: dto.platform,
      deviceId: dto.deviceId,
      deviceName: dto.deviceName,
    });

    return { message: 'Устройство успешно зарегистрировано' };
  }

  @Delete('unregister')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отключить push уведомления для устройства' })
  @ApiResponse({ status: 200, description: 'Устройство отключено' })
  async unregisterDevice(
    @CurrentUser('id') userId: string,
    @Body() dto: UnregisterDeviceDto,
  ) {
    await this.pushService.unregisterDevice(userId, dto.deviceId);

    return { message: 'Push уведомления отключены' };
  }
}

