import { Module } from '@nestjs/common'
import { EventsService } from './events.service'
import { EventsController } from './events.controller'
import { EventsRealtime } from './events-realtime'
import { FilesModule } from '../files/files.module'

// События (docs/PROJECT.md §3.5, задачи Ф10). Владеет Event/EventParticipant.
// EventsService экспортируется для CleanupService (cron scheduleEventReminders, задача 10.4).
// FilesModule — ради вложений обсуждения (ссылки на файлы); MediaModule глобальный.
// EventsRealtime — сигнал event.changed вузу события (§9.2d); RealtimeModule глобальный.
@Module({
  imports: [FilesModule],
  controllers: [EventsController],
  providers: [EventsService, EventsRealtime],
  exports: [EventsService],
})
export class EventsModule {}
