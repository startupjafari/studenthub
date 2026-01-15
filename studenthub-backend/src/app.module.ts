import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AdminModule } from './modules/admin/admin.module';
import { UniversitiesModule } from './modules/universities/universities.module';
import { MediaModule } from './modules/media/media.module';
import { PostsModule } from './modules/posts/posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { StoriesModule } from './modules/stories/stories.module';
import { FriendsModule } from './modules/friends/friends.module';
import { GroupsModule } from './modules/groups/groups.module';
import { GroupMessagesModule } from './modules/group-messages/group-messages.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { EventsModule } from './modules/events/events.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WebSocketModule } from './modules/websocket/websocket.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { PushModule } from './modules/push/push.module';
import { TagsModule } from './modules/tags/tags.module';
import { MentionsModule } from './modules/mentions/mentions.module';
import { PresenceModule } from './modules/presence/presence.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { PrismaService } from './common/services/prisma.service';
import { RedisModule } from './common/modules/redis.module';
import { CacheService } from './common/services/cache.service';
import { FileUploadService } from './common/services/file-upload.service';
import { TokenBlacklistService } from './common/services/token-blacklist.service';
import { FeedCacheService } from './common/services/feed-cache.service';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { CsrfGuard } from './common/guards/csrf.guard';
import { IpRateLimitGuard } from './common/guards/ip-rate-limit.guard';
import { CsrfInterceptor } from './common/interceptors/csrf.interceptor';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (_configService: ConfigService) => [
        {
          name: 'short',
          ttl: 60000, // 1 minute
          limit: 100, // 100 requests
        },
        {
          name: 'medium',
          ttl: 600000, // 10 minutes
          limit: 200, // 200 requests
        },
        {
          name: 'long',
          ttl: 900000, // 15 minutes
          limit: 500, // 500 requests
        },
      ],
      inject: [ConfigService],
    }),
    RedisModule,
    AuthModule,
    UsersModule,
    AdminModule,
    UniversitiesModule,
    MediaModule,
    PostsModule,
    CommentsModule,
    ReactionsModule,
    StoriesModule,
    FriendsModule,
    GroupsModule,
    GroupMessagesModule,
    DocumentsModule,
    EventsModule,
    ConversationsModule,
    MessagesModule,
    NotificationsModule,
    WebSocketModule,
    JobsModule,
    HealthModule,
    AuditModule,
    PushModule,
    TagsModule,
    MentionsModule,
    PresenceModule,
    ModerationModule,
    SchedulesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    CacheService,
    FileUploadService,
    TokenBlacklistService,
    FeedCacheService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: IpRateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CsrfInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
