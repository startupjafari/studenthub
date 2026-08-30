import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { SentryModule } from '@sentry/nestjs/setup'
import { validateEnv } from './config/env.schema'
import { CommonModule } from './common/common.module'
import { PrismaModule } from './common/prisma/prisma.module'
import { RedisModule } from './common/redis/redis.module'
// Счётчик ответов по статусам — им пользуются глобальные фильтр/интерцептор и ops-notify.
import { MonitoringModule } from './common/monitoring/monitoring.module'
import { QueueModule } from './common/queue/queue.module'
import { RealtimeModule } from './common/realtime/realtime.module'
import { MinioModule } from './common/minio/minio.module'
import { AuditModule } from './common/audit/audit.module'
import { SecurityModule } from './common/security/security.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { InvitesModule } from './modules/invites/invites.module'
import { FilesModule } from './modules/files/files.module'
import { UniversitiesModule } from './modules/universities/universities.module'
import { FacultiesModule } from './modules/faculties/faculties.module'
import { SpecialtiesModule } from './modules/specialties/specialties.module'
import { GroupsModule } from './modules/groups/groups.module'
import { RoomsModule } from './modules/rooms/rooms.module'
import { SchedulesModule } from './modules/schedules/schedules.module'
import { CoursesModule } from './modules/courses/courses.module'
import { AssignmentsModule } from './modules/assignments/assignments.module'
import { AttendanceModule } from './modules/attendance/attendance.module'
import { GradebookModule } from './modules/gradebook/gradebook.module'
import { ExamsModule } from './modules/exams/exams.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { SearchModule } from './modules/search/search.module'
import { KatoModule } from './modules/kato/kato.module'
import { ConsultationsModule } from './modules/consultations/consultations.module'
import { AppointmentsModule } from './modules/appointments/appointments.module'
import { PortfolioModule } from './modules/portfolio/portfolio.module'
import { CareerModule } from './modules/career/career.module'
import { StudentIdModule } from './modules/student-id/student-id.module'
// Заявки-услуги (переработка «Заявок в деканат», §3.2).
import { ApplicationServicesModule } from './modules/application-services/application-services.module'
import { PostsModule } from './modules/posts/posts.module'
import { ChatsModule } from './modules/chats/chats.module'
import { EventsModule } from './modules/events/events.module'
import { ComplaintsModule } from './modules/complaints/complaints.module'
import { MaterialsModule } from './modules/materials/materials.module'
import { ProfileContentModule } from './modules/profile-content/profile-content.module'
import { PollsModule } from './modules/polls/polls.module'
import { DocumentsModule } from './modules/documents/documents.module'
import { FriendsModule } from './modules/friends/friends.module'
import { EmailModule } from './modules/email/email.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PushModule } from './modules/push/push.module'
import { CleanupModule } from './modules/cleanup/cleanup.module'
import { HealthModule } from './modules/health/health.module'
// Служебный Telegram-канал (docs/TELEGRAM_BOT.md). Без TELEGRAM_BOT_TOKEN регистрирует
// только заглушку порта — ни воркера, ни фоновых запросов.
import { OpsNotifyModule } from './modules/ops-notify/ops-notify.module'
import { MeModule } from './modules/me/me.module'
import { AppController } from './app.controller'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Мониторинг (Ф13.8): даёт транзакциям Sentry имя роута вместо сырого URL.
    // Сам Sentry.init — в src/instrument.ts (до загрузки Nest); без DSN модуль безвреден.
    // Ошибки отправляет НЕ этот модуль, а HttpExceptionFilter (см. common/filters).
    SentryModule.forRoot(),
    // Глобальный rate limit по умолчанию 100/мин (§6.3); точечные лимиты — через @Throttle.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    CommonModule,
    PrismaModule,
    RedisModule,
    MonitoringModule,
    QueueModule,
    RealtimeModule,
    MinioModule,
    AuditModule,
    SecurityModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    FilesModule,
    UniversitiesModule,
    FacultiesModule,
    SpecialtiesModule,
    GroupsModule,
    RoomsModule,
    SchedulesModule,
    CoursesModule,
    AssignmentsModule,
    AttendanceModule,
    GradebookModule,
    ExamsModule,
    AnalyticsModule,
    SearchModule,
    KatoModule,
    ConsultationsModule,
    AppointmentsModule,
    PortfolioModule,
    CareerModule,
    StudentIdModule,
    ApplicationServicesModule,
    PostsModule,
    ChatsModule,
    EventsModule,
    ComplaintsModule,
    MaterialsModule,
    ProfileContentModule,
    PollsModule,
    DocumentsModule,
    FriendsModule,
    EmailModule,
    NotificationsModule,
    PushModule,
    CleanupModule,
    HealthModule,
    MeModule,
    OpsNotifyModule.register(),
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
