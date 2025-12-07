import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/services/prisma.service';
import * as admin from 'firebase-admin';

/**
 * Типы push уведомлений
 */
export enum PushNotificationType {
  NEW_MESSAGE = 'NEW_MESSAGE',
  NEW_COMMENT = 'NEW_COMMENT',
  NEW_REACTION = 'NEW_REACTION',
  NEW_FRIEND_REQUEST = 'NEW_FRIEND_REQUEST',
  FRIEND_REQUEST_ACCEPTED = 'FRIEND_REQUEST_ACCEPTED',
  NEW_POST = 'NEW_POST',
  MENTION = 'MENTION',
  GROUP_INVITE = 'GROUP_INVITE',
  EVENT_REMINDER = 'EVENT_REMINDER',
  SYSTEM = 'SYSTEM',
}

/**
 * Данные для push уведомления
 */
export interface PushNotificationData {
  userId: string;
  type: PushNotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  badge?: number;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private firebaseInitialized = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeFirebase();
  }

  /**
   * Инициализация Firebase Admin SDK
   */
  private async initializeFirebase(): Promise<void> {
    try {
      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
      const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

      if (!projectId || !clientEmail || !privateKey) {
        this.logger.warn('Firebase не настроен. Push уведомления отключены.');
        return;
      }

      // Проверяем, не инициализирован ли уже Firebase
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        });
      }

      this.firebaseInitialized = true;
      this.logger.log('Firebase Admin SDK инициализирован');
    } catch (error) {
      this.logger.error(`Ошибка инициализации Firebase: ${error.message}`);
    }
  }

  /**
   * Отправить push уведомление пользователю
   */
  async sendToUser(notification: PushNotificationData): Promise<boolean> {
    if (!this.firebaseInitialized) {
      this.logger.warn('Firebase не инициализирован, пропускаем отправку');
      return false;
    }

    try {
      // Получаем FCM токены пользователя
      const devices = await this.prisma.userDevice.findMany({
        where: {
          userId: notification.userId,
          pushEnabled: true,
          fcmToken: { not: null },
        },
      });

      if (devices.length === 0) {
        this.logger.debug(`У пользователя ${notification.userId} нет устройств для push`);
        return false;
      }

      const tokens = devices.map(d => d.fcmToken!).filter(Boolean);

      // Формируем сообщение
      const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.imageUrl,
        },
        data: {
          type: notification.type,
          ...notification.data,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: this.getChannelId(notification.type),
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              badge: notification.badge,
              sound: 'default',
            },
          },
        },
      };

      // Отправляем
      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.debug(
        `Push отправлен: ${response.successCount} успешно, ${response.failureCount} ошибок`,
      );

      // Удаляем невалидные токены
      if (response.failureCount > 0) {
        await this.handleFailedTokens(devices, response.responses);
      }

      return response.successCount > 0;
    } catch (error) {
      this.logger.error(`Ошибка отправки push: ${error.message}`);
      return false;
    }
  }

  /**
   * Отправить push уведомление нескольким пользователям
   */
  async sendToUsers(
    userIds: string[],
    notification: Omit<PushNotificationData, 'userId'>,
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const userId of userIds) {
      const result = await this.sendToUser({ ...notification, userId });
      if (result) success++;
      else failed++;
    }

    return { success, failed };
  }

  /**
   * Отправить уведомление всем пользователям (broadcast)
   */
  async sendBroadcast(
    notification: Omit<PushNotificationData, 'userId'>,
  ): Promise<{ success: number; failed: number }> {
    if (!this.firebaseInitialized) {
      return { success: 0, failed: 0 };
    }

    try {
      // Получаем все токены с включенными push
      const devices = await this.prisma.userDevice.findMany({
        where: {
          pushEnabled: true,
          fcmToken: { not: null },
        },
        select: { fcmToken: true },
      });

      const tokens = devices.map(d => d.fcmToken!).filter(Boolean);
      
      if (tokens.length === 0) {
        return { success: 0, failed: 0 };
      }

      // Отправляем батчами по 500 токенов (лимит FCM)
      const batchSize = 500;
      let success = 0;
      let failed = 0;

      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        
        const message: admin.messaging.MulticastMessage = {
          tokens: batch,
          notification: {
            title: notification.title,
            body: notification.body,
          },
          data: {
            type: notification.type,
            ...notification.data,
          },
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        success += response.successCount;
        failed += response.failureCount;
      }

      this.logger.log(`Broadcast отправлен: ${success} успешно, ${failed} ошибок`);
      return { success, failed };
    } catch (error) {
      this.logger.error(`Ошибка broadcast: ${error.message}`);
      return { success: 0, failed: 0 };
    }
  }

  /**
   * Зарегистрировать FCM токен устройства
   */
  async registerDevice(
    userId: string,
    fcmToken: string,
    deviceInfo: {
      platform: 'ios' | 'android' | 'web';
      deviceId?: string;
      deviceName?: string;
    },
  ): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId: deviceInfo.deviceId || fcmToken.substring(0, 50),
        },
      },
      update: {
        fcmToken,
        platform: deviceInfo.platform,
        deviceName: deviceInfo.deviceName,
        lastActiveAt: new Date(),
      },
      create: {
        userId,
        fcmToken,
        deviceId: deviceInfo.deviceId || fcmToken.substring(0, 50),
        platform: deviceInfo.platform,
        deviceName: deviceInfo.deviceName,
        pushEnabled: true,
      },
    });

    this.logger.debug(`Устройство зарегистрировано для пользователя ${userId}`);
  }

  /**
   * Отключить push уведомления для устройства
   */
  async unregisterDevice(userId: string, deviceId: string): Promise<void> {
    await this.prisma.userDevice.updateMany({
      where: { userId, deviceId },
      data: { pushEnabled: false, fcmToken: null },
    });
  }

  /**
   * Получить канал уведомлений для Android
   */
  private getChannelId(type: PushNotificationType): string {
    switch (type) {
      case PushNotificationType.NEW_MESSAGE:
        return 'messages';
      case PushNotificationType.NEW_FRIEND_REQUEST:
      case PushNotificationType.FRIEND_REQUEST_ACCEPTED:
        return 'friends';
      case PushNotificationType.NEW_COMMENT:
      case PushNotificationType.NEW_REACTION:
      case PushNotificationType.MENTION:
        return 'activity';
      case PushNotificationType.EVENT_REMINDER:
        return 'events';
      default:
        return 'default';
    }
  }

  /**
   * Обработать неудачные токены
   */
  private async handleFailedTokens(
    devices: { id: string; fcmToken: string | null }[],
    responses: admin.messaging.SendResponse[],
  ): Promise<void> {
    const invalidTokenIds: string[] = [];

    responses.forEach((response, index) => {
      if (!response.success && response.error) {
        const errorCode = response.error.code;
        // Токен невалиден или устройство отключено
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          invalidTokenIds.push(devices[index].id);
        }
      }
    });

    if (invalidTokenIds.length > 0) {
      await this.prisma.userDevice.updateMany({
        where: { id: { in: invalidTokenIds } },
        data: { fcmToken: null, pushEnabled: false },
      });
      
      this.logger.debug(`Удалено ${invalidTokenIds.length} невалидных токенов`);
    }
  }

  // ==================== ХЕЛПЕРЫ ДЛЯ РАЗНЫХ ТИПОВ УВЕДОМЛЕНИЙ ====================

  /**
   * Уведомление о новом сообщении
   */
  async notifyNewMessage(
    userId: string,
    senderName: string,
    messagePreview: string,
    conversationId: string,
  ): Promise<void> {
    await this.sendToUser({
      userId,
      type: PushNotificationType.NEW_MESSAGE,
      title: senderName,
      body: messagePreview.substring(0, 100),
      data: {
        conversationId,
        action: 'OPEN_CONVERSATION',
      },
    });
  }

  /**
   * Уведомление о новом комментарии
   */
  async notifyNewComment(
    userId: string,
    commenterName: string,
    postId: string,
  ): Promise<void> {
    await this.sendToUser({
      userId,
      type: PushNotificationType.NEW_COMMENT,
      title: 'Новый комментарий',
      body: `${commenterName} прокомментировал ваш пост`,
      data: {
        postId,
        action: 'OPEN_POST',
      },
    });
  }

  /**
   * Уведомление о новой реакции
   */
  async notifyNewReaction(
    userId: string,
    reactorName: string,
    postId: string,
  ): Promise<void> {
    await this.sendToUser({
      userId,
      type: PushNotificationType.NEW_REACTION,
      title: 'Новая реакция',
      body: `${reactorName} отреагировал на ваш пост`,
      data: {
        postId,
        action: 'OPEN_POST',
      },
    });
  }

  /**
   * Уведомление о запросе в друзья
   */
  async notifyFriendRequest(
    userId: string,
    senderName: string,
    senderId: string,
  ): Promise<void> {
    await this.sendToUser({
      userId,
      type: PushNotificationType.NEW_FRIEND_REQUEST,
      title: 'Запрос в друзья',
      body: `${senderName} хочет добавить вас в друзья`,
      data: {
        senderId,
        action: 'OPEN_FRIEND_REQUESTS',
      },
    });
  }

  /**
   * Уведомление о принятии запроса в друзья
   */
  async notifyFriendRequestAccepted(
    userId: string,
    friendName: string,
    friendId: string,
  ): Promise<void> {
    await this.sendToUser({
      userId,
      type: PushNotificationType.FRIEND_REQUEST_ACCEPTED,
      title: 'Запрос принят',
      body: `${friendName} принял ваш запрос в друзья`,
      data: {
        friendId,
        action: 'OPEN_PROFILE',
      },
    });
  }
}

