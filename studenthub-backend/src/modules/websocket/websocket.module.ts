import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { MessagesGateway } from './gateways/messages.gateway';
import { GroupsGateway } from './gateways/groups.gateway';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import { MessagesModule } from '../messages/messages.module';
import { PrismaService } from '../../common/services/prisma.service';
import { RedisModule } from '../../common/modules/redis.module';

@Module({
  imports: [
    JwtModule,
    ConfigModule,
    RedisModule,
    forwardRef(() => MessagesModule),
  ],
  providers: [
    MessagesGateway,
    GroupsGateway,
    NotificationsGateway,
    WsJwtGuard,
    WsRateLimitGuard,
    PrismaService,
  ],
  exports: [MessagesGateway, GroupsGateway, NotificationsGateway],
})
export class WebSocketModule {}

