import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../../common/modules/redis.module';
import Redis from 'ioredis';
import { Socket } from 'socket.io';

@Injectable()
export class WsRateLimitGuard implements CanActivate {
  private readonly windowMs = 60000; // 1 минута
  private readonly maxConnections = 10; // Максимум соединений с одного IP в минуту
  private readonly maxMessages = 100; // Максимум сообщений на соединение в минуту

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const ip = this.getClientIp(client);

    // Ограничение количества соединений
    const connectionKey = `ws:connection:${ip}`;
    const connections = await this.redis.incr(connectionKey);

    if (connections === 1) {
      await this.redis.pexpire(connectionKey, this.windowMs);
    }

    if (connections > this.maxConnections) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Слишком много WebSocket соединений с этого IP',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Ограничение количества сообщений на соединение
    if (client.data?.userId) {
      const messageKey = `ws:messages:${client.data.userId}:${client.id}`;
      const messages = await this.redis.incr(messageKey);

      if (messages === 1) {
        await this.redis.pexpire(messageKey, this.windowMs);
      }

      if (messages > this.maxMessages) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Слишком много сообщений, пожалуйста подождите',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  /**
   * Получить IP адрес клиента из сокета
   */
  private getClientIp(client: Socket): string {
    return (
      (client.handshake.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (client.handshake.headers['x-real-ip'] as string) ||
      client.handshake.address ||
      'unknown'
    );
  }
}
