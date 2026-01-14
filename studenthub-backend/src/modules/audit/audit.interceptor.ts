import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService, AuditAction } from './audit.service';
import { Request } from 'express';

/**
 * Интерцептор для автоматического логирования действий
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, body } = request;
    const user = request.user as any;
    const startTime = Date.now();

    // Определяем действие на основе метода и URL
    const action = this.getActionFromRequest(method, url);
    
    // Пропускаем логирование для некоторых endpoints
    if (this.shouldSkipLogging(url)) {
      return next.handle();
    }

    // Извлекаем ID ресурса из URL
    const resourceId = this.extractResourceId(url);
    const resource = this.extractResource(url);

    return next.handle().pipe(
      tap(async (response) => {
        const duration = Date.now() - startTime;
        
        await this.auditService.log({
          userId: user?.id,
          action,
          resource,
          resourceId,
          details: {
            method,
            url,
            duration: `${duration}ms`,
            statusCode: 200,
            // Не логируем пароли и чувствительные данные
            body: this.sanitizeBody(body),
          },
          ip: this.getClientIp(request),
          userAgent: request.headers['user-agent'],
          success: true,
        });
      }),
      catchError(async (error) => {
        const duration = Date.now() - startTime;
        
        await this.auditService.log({
          userId: user?.id,
          action,
          resource,
          resourceId,
          details: {
            method,
            url,
            duration: `${duration}ms`,
            statusCode: error.status || 500,
          },
          ip: this.getClientIp(request),
          userAgent: request.headers['user-agent'],
          success: false,
          errorMessage: error.message,
        });

        throw error;
      }),
    );
  }

  /**
   * Определить действие на основе запроса
   */
  private getActionFromRequest(method: string, url: string): AuditAction {
    // Аутентификация
    if (url.includes('/auth/login')) return AuditAction.LOGIN;
    if (url.includes('/auth/logout')) return AuditAction.LOGOUT;
    if (url.includes('/auth/register')) return AuditAction.REGISTER;
    if (url.includes('/auth/change-password')) return AuditAction.PASSWORD_CHANGE;
    if (url.includes('/auth/reset-password')) return AuditAction.PASSWORD_RESET;
    if (url.includes('/auth/verify-email')) return AuditAction.EMAIL_VERIFIED;
    if (url.includes('/auth/2fa/enable')) return AuditAction.TWO_FACTOR_ENABLED;
    if (url.includes('/auth/2fa/disable')) return AuditAction.TWO_FACTOR_DISABLED;

    // Посты
    if (url.includes('/posts')) {
      if (method === 'POST') return AuditAction.POST_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.POST_UPDATE;
      if (method === 'DELETE') return AuditAction.POST_DELETE;
      if (method === 'GET') return AuditAction.POST_VIEW;
    }

    // Комментарии
    if (url.includes('/comments')) {
      if (method === 'POST') return AuditAction.COMMENT_CREATE;
      if (method === 'PUT' || method === 'PATCH') return AuditAction.COMMENT_UPDATE;
      if (method === 'DELETE') return AuditAction.COMMENT_DELETE;
    }

    // Реакции
    if (url.includes('/reactions')) {
      if (method === 'POST') return AuditAction.REACTION_ADD;
      if (method === 'DELETE') return AuditAction.REACTION_REMOVE;
    }

    // Друзья
    if (url.includes('/friends')) {
      if (url.includes('/request') && method === 'POST') return AuditAction.FRIEND_REQUEST_SEND;
      if (url.includes('/accept')) return AuditAction.FRIEND_REQUEST_ACCEPT;
      if (url.includes('/reject')) return AuditAction.FRIEND_REQUEST_REJECT;
      if (method === 'DELETE') return AuditAction.FRIEND_REMOVE;
    }

    // Сообщения
    if (url.includes('/messages')) {
      if (method === 'POST') return AuditAction.MESSAGE_SEND;
      if (method === 'DELETE') return AuditAction.MESSAGE_DELETE;
    }

    // Группы
    if (url.includes('/groups')) {
      if (method === 'POST' && !url.includes('/join') && !url.includes('/leave')) {
        return AuditAction.GROUP_CREATE;
      }
      if (method === 'PUT' || method === 'PATCH') return AuditAction.GROUP_UPDATE;
      if (method === 'DELETE') return AuditAction.GROUP_DELETE;
      if (url.includes('/join')) return AuditAction.GROUP_JOIN;
      if (url.includes('/leave')) return AuditAction.GROUP_LEAVE;
    }

    // Файлы
    if (url.includes('/media') || url.includes('/upload')) {
      if (method === 'POST') return AuditAction.FILE_UPLOAD;
      if (method === 'DELETE') return AuditAction.FILE_DELETE;
    }

    // Пользователи
    if (url.includes('/users')) {
      if (method === 'PUT' || method === 'PATCH') return AuditAction.USER_UPDATE;
      if (method === 'DELETE') return AuditAction.USER_DELETE;
    }

    // Админ
    if (url.includes('/admin')) {
      return AuditAction.ADMIN_ACTION;
    }

    return AuditAction.API_REQUEST;
  }

  /**
   * Извлечь ID ресурса из URL
   */
  private extractResourceId(url: string): string | undefined {
    // Ищем UUID или CUID в URL
    const uuidMatch = url.match(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    );
    if (uuidMatch) return uuidMatch[0];

    const cuidMatch = url.match(/c[a-z0-9]{24}/i);
    if (cuidMatch) return cuidMatch[0];

    return undefined;
  }

  /**
   * Извлечь название ресурса из URL
   */
  private extractResource(url: string): string {
    const parts = url.split('/').filter(p => p && !p.match(/^(api|v1|v2)$/));
    return parts[0] || 'unknown';
  }

  /**
   * Пропустить логирование для некоторых endpoints
   */
  private shouldSkipLogging(url: string): boolean {
    const skipPatterns = [
      '/health',
      '/metrics',
      '/favicon',
      '/swagger',
      '/docs',
    ];
    
    return skipPatterns.some(pattern => url.includes(pattern));
  }

  /**
   * Убрать чувствительные данные из body
   */
  private sanitizeBody(body: any): any {
    if (!body) return undefined;
    
    const sensitiveFields = [
      'password',
      'passwordHash',
      'currentPassword',
      'newPassword',
      'token',
      'refreshToken',
      'accessToken',
      'secret',
      'twoFactorSecret',
    ];

    const sanitized = { ...body };
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[HIDDEN]';
      }
    }

    return sanitized;
  }

  /**
   * Получить IP клиента
   */
  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }
}





