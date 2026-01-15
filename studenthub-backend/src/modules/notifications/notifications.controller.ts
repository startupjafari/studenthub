import { Controller, Get, Patch, Delete, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GetNotificationsDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get notifications',
    description:
      'Returns paginated list of user notifications. Supports filtering by read status and type.',
  })
  @ApiQuery({
    name: 'isRead',
    required: false,
    type: Boolean,
    description: 'Filter by read status',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [
      'FRIEND_REQUEST',
      'FRIEND_ACCEPTED',
      'MESSAGE',
      'POST_COMMENT',
      'POST_REACTION',
      'STORY_VIEW',
      'GROUP_INVITE',
      'EVENT',
      'TEACHER_MESSAGE',
      'DOCUMENT_REQUEST',
      'DOCUMENT_UPDATED',
      'ROLE_CHANGED',
    ],
    description: 'Filter by notification type',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20, max: 100)',
  })
  @ApiResponse({ status: 200, description: 'Notifications retrieved successfully' })
  async getNotifications(@CurrentUser() user: User, @Query() dto: GetNotificationsDto) {
    return this.notificationsService.getNotifications(user.id, dto);
  }

  @Get('unread')
  @ApiOperation({
    summary: 'Get unread count',
    description: 'Returns count of unread notifications. Cached for 1 minute.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count retrieved successfully',
    schema: { type: 'object', properties: { count: { type: 'number' } } },
  })
  async getUnreadCount(@CurrentUser() user: User) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks a notification as read. Invalidates unread count cache.',
  })
  @ApiParam({ name: 'id', description: 'Notification ID', type: String })
  @ApiResponse({ status: 200, description: 'Notification marked as read successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Access denied' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async markAsRead(@Param('id') id: string, @CurrentUser() user: User) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete notification',
    description:
      'Deletes a notification. Only the notification recipient can delete their own notifications.',
  })
  @ApiParam({ name: 'id', description: 'Notification ID', type: String })
  @ApiResponse({ status: 200, description: 'Notification deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Access denied' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  async deleteNotification(@Param('id') id: string, @CurrentUser() user: User) {
    return this.notificationsService.deleteNotification(id, user.id);
  }

  @Delete()
  @ApiOperation({
    summary: 'Clear all notifications',
    description: 'Deletes all notifications for the current user.',
  })
  @ApiResponse({ status: 200, description: 'All notifications cleared successfully' })
  async clearAll(@CurrentUser() user: User) {
    return this.notificationsService.clearAll(user.id);
  }
}
