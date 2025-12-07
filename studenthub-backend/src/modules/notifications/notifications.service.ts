import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { CacheService } from '../../common/services/cache.service';
import { GetNotificationsDto } from './dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { NotificationsGateway } from '../websocket/gateways/notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Get user's notifications
   */
  async getNotifications(userId: string, dto: GetNotificationsDto) {
    const where: any = {
      recipientId: userId,
    };

    if (dto.isRead !== undefined) {
      where.isRead = dto.isRead;
    }

    if (dto.type) {
      where.type = dto.type;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return new PaginatedResponse(notifications, total, dto);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string) {
    const cacheKey = `notifications:unread:${userId}`;
    const cached = await this.cache.get<number>(cacheKey);

    if (cached !== null) {
      return { count: cached };
    }

    const count = await this.prisma.notification.count({
      where: {
        recipientId: userId,
        isRead: false,
      },
    });

    // Cache for 1 minute
    await this.cache.set(cacheKey, count, 60);

    return { count };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.recipientId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    // Invalidate cache
    await this.cache.delete(`notifications:unread:${userId}`);

    return { message: 'Notification marked as read' };
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.recipientId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    // Invalidate cache
    await this.cache.delete(`notifications:unread:${userId}`);

    return { message: 'Notification deleted' };
  }

  /**
   * Clear all notifications
   */
  async clearAll(userId: string) {
    await this.prisma.notification.deleteMany({
      where: { recipientId: userId },
    });

    // Invalidate cache
    await this.cache.delete(`notifications:unread:${userId}`);

    return { message: 'All notifications cleared' };
  }
}

