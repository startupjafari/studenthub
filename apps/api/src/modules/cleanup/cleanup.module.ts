import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { CleanupService } from './cleanup.service'
import { EventsModule } from '../events/events.module'
import { PostsModule } from '../posts/posts.module'
import { DocumentsModule } from '../documents/documents.module'

// Планировщик cron-задач очистки (docs/PROJECT.md §10.2). ScheduleModule.forRoot()
// регистрируется здесь один раз; PrismaService/MINIO_CLIENT/ConfigService — глобальные.
// EventsModule — для scheduleEventReminders (cron делегирует EventsService.remindDue, §9.3).
@Module({
  imports: [ScheduleModule.forRoot(), EventsModule, PostsModule, DocumentsModule],
  providers: [CleanupService],
})
export class CleanupModule {}
