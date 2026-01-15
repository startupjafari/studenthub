import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { MessagesGateway } from './gateways/messages.gateway';
import { GroupsGateway } from './gateways/groups.gateway';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { PresenceGateway } from './gateways/presence.gateway';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import { MessagesModule } from '../messages/messages.module';
import { PresenceModule } from '../presence/presence.module';
import { PrismaService } from '../../common/services/prisma.service';
import { RedisModule } from '../../common/modules/redis.module';

@Module({
  imports: [JwtModule, ConfigModule, RedisModule, forwardRef(() => MessagesModule), PresenceModule],
  providers: [
    MessagesGateway,
    GroupsGateway,
    NotificationsGateway,
    PresenceGateway,
    WsJwtGuard,
    WsRateLimitGuard,
    PrismaService,
  ],
  exports: [MessagesGateway, GroupsGateway, NotificationsGateway, PresenceGateway],
})
export class WebSocketModule {}
