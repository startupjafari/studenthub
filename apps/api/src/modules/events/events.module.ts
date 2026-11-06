import { Module } from '@nestjs/common'
import { EventsService } from './events.service'
import { EventsController } from './events.controller'
import { FilesModule } from '../files/files.module'

// События (docs/PROJECT.md §3.5, задачи Ф10). Владеет Event/EventParticipant.
// EventsService экспортируется для CleanupService (cron scheduleEventReminders, задача 10.4).
// FilesModule — ради вложений обсуждения (ссылки на файлы); MediaModule глобальный.
@Module({
  imports: [FilesModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
