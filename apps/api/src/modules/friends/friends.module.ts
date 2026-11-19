import { Module } from '@nestjs/common'
import { FriendsService } from './friends.service'
import { FriendsController } from './friends.controller'
import { FriendsRealtimeModule } from './friends-realtime.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { ChatsModule } from '../chats/chats.module'

// QueueService и PrismaService доступны глобально (QueueModule/PrismaModule @Global).
// NotificationsModule — сброс кэша непрочитанных, ChatsModule — снятие запроса на переписку
// при дружбе (§3.6). Обратной зависимости нет: чаты читают дружбу сами.
// FriendsRealtimeModule — сигналы второй стороне (§9.2d); отдельным модулем, потому что их шлют
// и чаты (блокировка рвёт дружбу). RealtimeGateway даёт глобальный RealtimeModule.
@Module({
  imports: [NotificationsModule, ChatsModule, FriendsRealtimeModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
