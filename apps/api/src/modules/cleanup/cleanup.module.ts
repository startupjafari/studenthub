import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { CronMonitorService } from '../../common/monitoring/cron-monitor.service'
import { CleanupService } from './cleanup.service'
import { EventsModule } from '../events/events.module'
import { PostsModule } from '../posts/posts.module'
import { DocumentsModule } from '../documents/documents.module'

// Планировщик cron-задач очистки (docs/PROJECT.md §10.2). ScheduleModule.forRoot()
// регистрируется здесь один раз; PrismaService/MINIO_CLIENT/ConfigService — глобальные.
// EventsModule — для scheduleEventReminders (cron делегирует EventsService.remindDue, §9.3).
// CronMonitorService живёт здесь же: ему нужен SchedulerRegistry из ScheduleModule (Ф13.8).
@Module({
  imports: [ScheduleModule.forRoot(), EventsModule, PostsModule, DocumentsModule],
  providers: [CleanupService, CronMonitorService],
})
export class CleanupModule {}
