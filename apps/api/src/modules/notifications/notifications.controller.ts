import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { NotificationsService } from './notifications.service'
import { NotificationListQueryDto } from './dto/notification-list-query.dto'
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto'

// Каждый пользователь управляет ТОЛЬКО своими уведомлениями (userId из JWT, не из запроса).
// Статические пути (settings, unread-count, read-all) объявлены до :id.
@ApiTags('Уведомления')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Лента уведомлений (cursor-пагинация)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: NotificationListQueryDto) {
    return this.notifications.list(user.sub, query)
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Число непрочитанных (Redis-кэш)' })
  unreadCount(@CurrentUser() user: CurrentUserData) {
    return this.notifications.unreadCount(user.sub)
  }

  @Get('settings')
  @ApiOperation({ summary: 'Настройки уведомлений' })
  getSettings(@CurrentUser() user: CurrentUserData) {
    return this.notifications.getSettings(user.sub)
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Обновить настройки уведомлений' })
  updateSettings(@CurrentUser() user: CurrentUserData, @Body() dto: UpdateNotificationSettingsDto) {
    return this.notifications.updateSettings(user.sub, dto)
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Отметить все прочитанными' })
  markAllRead(@CurrentUser() user: CurrentUserData) {
    return this.notifications.markAllRead(user.sub)
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Отметить уведомление прочитанным' })
  markRead(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить уведомление' })
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.notifications.remove(user.sub, id)
  }
}
