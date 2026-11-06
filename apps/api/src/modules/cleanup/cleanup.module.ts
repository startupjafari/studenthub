import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { CronMonitorService } from '../../common/monitoring/cron-monitor.service'
import { CleanupService } from './cleanup.service'
import { PdRetentionService } from './pd-retention.service'
import { EventsModule } from '../events/events.module'
import { PostsModule } from '../posts/posts.module'
import { StoriesModule } from '../stories/stories.module'
import { DocumentsModule } from '../documents/documents.module'
import { ChatsModule } from '../chats/chats.module'
import { ComplaintsModule } from '../complaints/complaints.module'
import { OnboardingModule } from '../onboarding/onboarding.module'
import { CareerModule } from '../career/career.module'
import { ApplicationServicesModule } from '../application-services/application-services.module'
import { UsersModule } from '../users/users.module'
import { LibraryModule } from '../library/library.module'

// Планировщик cron-задач очистки (docs/PROJECT.md §10.2). ScheduleModule.forRoot()
// регистрируется здесь один раз; PrismaService/MINIO_CLIENT/ConfigService — глобальные.
// EventsModule — для scheduleEventReminders (cron делегирует EventsService.remindDue, §9.3).
// StoriesModule — для deleteExpiredStories (истёкшие сторисы удаляет владелец домена).
// ChatsModule — для deliverScheduledMessages (доставка отложенных сообщений тем же способом).
// CronMonitorService живёт здесь же: ему нужен SchedulerRegistry из ScheduleModule (Ф13.8).
// ComplaintsModule — за размером очереди для сводки и сигнала о заторе: считает его владелец
// таблицы, а не планировщик (§2.1).
// CareerModule — для expireCompanyAccess (истечение допусков компаний закрывает их владелец).
// ApplicationServicesModule — для notifyOverdueApplications (сводку просрочки собирает домен заявок).
// DocumentsModule — ещё и для closeOverdueDocumentRequests (запросы документов по сроку).
// UsersModule — штатное удаление аккаунта для purgeUnverifiedEmployers (UserService.softDeleteSelf).
// LibraryModule — напоминания о сроке выдачи книг (remindLibraryLoans).
// PdRetentionService — сроки хранения ПДн (PERSONAL_DATA §4): отбор и удаление по срокам,
// расписание — в CleanupService; профили удаляет штатный UserService.softDeleteSelf.
@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventsModule,
    PostsModule,
    StoriesModule,
    DocumentsModule,
    ChatsModule,
    ComplaintsModule,
    OnboardingModule,
    CareerModule,
    ApplicationServicesModule,
    UsersModule,
    LibraryModule,
  ],
  providers: [CleanupService, PdRetentionService, CronMonitorService],
  exports: [CleanupService],
})
export class CleanupModule {}
