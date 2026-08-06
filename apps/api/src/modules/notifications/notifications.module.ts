import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import { NotificationsProcessor } from './notifications.processor'

// Уведомления (docs/PROJECT.md §10.1): REST (Ф3.5) + воркер очереди `notifications` (Ф3.4).
// RealtimeGateway (WS) и QueueService (email-фолбэк) — из глобальных RealtimeModule/QueueModule.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
