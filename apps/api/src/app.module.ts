import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { validateEnv } from './config/env.schema'
import { CommonModule } from './common/common.module'
import { PrismaModule } from './common/prisma/prisma.module'
import { RedisModule } from './common/redis/redis.module'
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
import { ApplicationsModule } from './modules/applications/applications.module'
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
import { AppController } from './app.controller'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // Глобальный rate limit по умолчанию 100/мин (§6.3); точечные лимиты — через @Throttle.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    CommonModule,
    PrismaModule,
    RedisModule,
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
    ApplicationsModule,
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
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
