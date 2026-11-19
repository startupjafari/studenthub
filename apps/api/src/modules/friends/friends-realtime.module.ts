import { Module } from '@nestjs/common'
import { FriendsRealtime } from './friends-realtime'

// Сигнал `friends.changed` (§9.2d) отдельным модулем: его шлют и друзья, и чаты — блокировка
// в чате рвёт дружбу. FriendsModule уже импортирует ChatsModule (снятие запроса на переписку
// при дружбе), и импорт FriendsModule обратно в чаты замкнул бы кольцо — поэтому третий
// модуль (BACKEND_RULES §2.1), а не forwardRef. Зависимостей, кроме глобального
// RealtimeGateway, у него нет.
@Module({
  providers: [FriendsRealtime],
  exports: [FriendsRealtime],
})
export class FriendsRealtimeModule {}
