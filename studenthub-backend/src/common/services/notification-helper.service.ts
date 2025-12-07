import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { NotificationsGateway } from '../../modules/websocket/gateways/notifications.gateway';

@Injectable()
export class NotificationHelperService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsGateway))
    private notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Create notification and emit via WebSocket
   */
  async createNotification(
    recipientId: string,
    data: {
      type: string;
      title: string;
      message: string;
      data?: any;
    },
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        recipientId,
        type: data.type as any,
        title: data.title,
        message: data.message,
        data: data.data || {},
      },
    });

    // Emit via WebSocket
    if (this.notificationsGateway) {
      this.notificationsGateway.emitNewNotification(recipientId, notification);
    }

    return notification;
  }
}





