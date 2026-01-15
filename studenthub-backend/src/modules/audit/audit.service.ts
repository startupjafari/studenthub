import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { REDIS_CLIENT } from '../../common/modules/redis.module';
import Redis from 'ioredis';

/**
 * Тип действия в системе
 */
export enum AuditAction {
  // Аутентификация
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_DISABLED = 'TWO_FACTOR_DISABLED',

  // Регистрация
  REGISTER = 'REGISTER',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',

  // Пользователи
  USER_CREATE = 'USER_CREATE',
  USER_UPDATE = 'USER_UPDATE',
  USER_DELETE = 'USER_DELETE',
  USER_BLOCK = 'USER_BLOCK',
  USER_UNBLOCK = 'USER_UNBLOCK',

  // Посты
  POST_CREATE = 'POST_CREATE',
  POST_UPDATE = 'POST_UPDATE',
  POST_DELETE = 'POST_DELETE',
  POST_VIEW = 'POST_VIEW',

  // Комментарии
  COMMENT_CREATE = 'COMMENT_CREATE',
  COMMENT_UPDATE = 'COMMENT_UPDATE',
  COMMENT_DELETE = 'COMMENT_DELETE',

  // Реакции
  REACTION_ADD = 'REACTION_ADD',
  REACTION_REMOVE = 'REACTION_REMOVE',

  // Друзья
  FRIEND_REQUEST_SEND = 'FRIEND_REQUEST_SEND',
  FRIEND_REQUEST_ACCEPT = 'FRIEND_REQUEST_ACCEPT',
  FRIEND_REQUEST_REJECT = 'FRIEND_REQUEST_REJECT',
  FRIEND_REMOVE = 'FRIEND_REMOVE',

  // Сообщения
  MESSAGE_SEND = 'MESSAGE_SEND',
  MESSAGE_DELETE = 'MESSAGE_DELETE',

  // Группы
  GROUP_CREATE = 'GROUP_CREATE',
  GROUP_UPDATE = 'GROUP_UPDATE',
  GROUP_DELETE = 'GROUP_DELETE',
  GROUP_JOIN = 'GROUP_JOIN',
  GROUP_LEAVE = 'GROUP_LEAVE',

  // Файлы
  FILE_UPLOAD = 'FILE_UPLOAD',
  FILE_DELETE = 'FILE_DELETE',

  // Админ действия
  ADMIN_ACTION = 'ADMIN_ACTION',
  SETTINGS_CHANGE = 'SETTINGS_CHANGE',

  // API
  API_REQUEST = 'API_REQUEST',
  API_ERROR = 'API_ERROR',
}

/**
 * Данные для записи в аудит лог
 */
export interface AuditLogData {
  userId?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
  timestamp?: Date;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  // Буфер для batch записи (оптимизация)
  private logBuffer: AuditLogData[] = [];
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000; // 5 секунд

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Периодическая запись буфера в БД
    setInterval(() => this.flushBuffer(), this.FLUSH_INTERVAL);
  }

  /**
   * Записать действие в аудит лог
   */
  async log(data: AuditLogData): Promise<void> {
    try {
      // Добавляем временную метку
      const logEntry = {
        ...data,
        timestamp: new Date(),
      };

      // Добавляем в буфер
      this.logBuffer.push(logEntry);

      // Записываем в Redis для быстрого доступа (последние 1000 записей)
      await this.redis.lpush('audit:recent', JSON.stringify(logEntry));
      await this.redis.ltrim('audit:recent', 0, 999);

      // Если буфер полон, записываем в БД
      if (this.logBuffer.length >= this.BUFFER_SIZE) {
        await this.flushBuffer();
      }

      this.logger.debug(
        `Аудит: ${data.action} | User: ${data.userId || 'anonymous'} | Resource: ${data.resource || '-'}`,
      );
    } catch (error) {
      this.logger.error(`Ошибка записи в аудит лог: ${error.message}`);
    }
  }

  /**
   * Записать буфер в базу данных
   */
  private async flushBuffer(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logsToWrite = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.prisma.auditLog.createMany({
        data: logsToWrite.map((log) => ({
          userId: log.userId,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          details: log.details ? JSON.stringify(log.details) : null,
          ip: log.ip,
          userAgent: log.userAgent,
          success: log.success ?? true,
          errorMessage: log.errorMessage,
          createdAt: log.timestamp || new Date(),
        })),
      });

      this.logger.debug(`Записано ${logsToWrite.length} записей в аудит лог`);
    } catch (error) {
      // Возвращаем логи в буфер при ошибке
      this.logBuffer = [...logsToWrite, ...this.logBuffer];
      this.logger.error(`Ошибка записи буфера в БД: ${error.message}`);
    }
  }

  /**
   * Получить последние записи аудита из Redis (быстро)
   */
  async getRecentLogs(limit: number = 100): Promise<AuditLogData[]> {
    const logs = await this.redis.lrange('audit:recent', 0, limit - 1);
    return logs.map((log) => JSON.parse(log));
  }

  /**
   * Получить логи пользователя
   */
  async getUserLogs(
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where: { userId } }),
    ]);

    return { data, total };
  }

  /**
   * Получить логи по действию
   */
  async getLogsByAction(
    action: AuditAction,
    page: number = 1,
    limit: number = 50,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { action },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where: { action } }),
    ]);

    return { data, total };
  }

  /**
   * Получить статистику действий
   */
  async getActionStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ action: string; count: number }[]> {
    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const stats = await this.prisma.auditLog.groupBy({
      by: ['action'],
      _count: { action: true },
      where,
      orderBy: { _count: { action: 'desc' } },
    });

    return stats.map((s) => ({
      action: s.action,
      count: s._count.action,
    }));
  }

  /**
   * Поиск подозрительной активности
   */
  async findSuspiciousActivity(
    threshold: number = 100, // Больше 100 действий за час
  ): Promise<{ userId: string; actionCount: number; ip: string }[]> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const suspicious = await this.prisma.auditLog.groupBy({
      by: ['userId', 'ip'],
      _count: { id: true },
      where: {
        createdAt: { gte: oneHourAgo },
        userId: { not: null },
      },
      having: {
        id: { _count: { gt: threshold } },
      },
    });

    return suspicious.map((s) => ({
      userId: s.userId!,
      actionCount: s._count.id,
      ip: s.ip || 'unknown',
    }));
  }

  /**
   * Очистить старые логи (для cron задачи)
   */
  async cleanupOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    });

    this.logger.log(`Удалено ${result.count} старых записей аудита`);
    return result.count;
  }
}
