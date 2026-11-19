import { Module } from '@nestjs/common'
import { FriendsService } from './friends.service'
import { FriendsController } from './friends.controller'
import { FriendsRealtime } from './friends-realtime'
import { NotificationsModule } from '../notifications/notifications.module'
import { ChatsModule } from '../chats/chats.module'

// QueueService и PrismaService доступны глобально (QueueModule/PrismaModule @Global).
// NotificationsModule — сброс кэша непрочитанных, ChatsModule — снятие запроса на переписку
// при дружбе (§3.6). Обратной зависимости нет: чаты читают дружбу сами.
// FriendsRealtime — сигналы второй стороне (§9.2d); RealtimeGateway даёт глобальный RealtimeModule.
@Module({
  imports: [NotificationsModule, ChatsModule],
  controllers: [FriendsController],
  providers: [FriendsService, FriendsRealtime],
  exports: [FriendsService],
})
export class FriendsModule {}
