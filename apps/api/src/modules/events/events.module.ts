import { Module } from '@nestjs/common'
import { EventsService } from './events.service'
import { EventsController } from './events.controller'

// События (docs/PROJECT.md §3.5, задачи Ф10). Владеет Event/EventParticipant.
// EventsService экспортируется для CleanupService (cron scheduleEventReminders, задача 10.4).
@Module({
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
