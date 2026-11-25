import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { CareerModule } from '../career/career.module'
import { PostsService } from './posts.service'
import { PostsController } from './posts.controller'
import { PostLiveEvents } from './post-live-events'

// Посты и лента (docs/PROJECT.md §3.3, задачи Ф8). Владеет Post/Reaction/Comment.
// Медиа привязываются к File (posts-media) по File.postId; PrismaService/ConfigService — глобальные.
// FilesModule — presigned-URL к медиа поста (по видимости поста, FileService).
// CareerModule — посты страницы компании: её видимость и право публиковать от её имени.
// PostLiveEvents — сигналы живой ленты (§9.2d); RealtimeGateway — из глобального RealtimeModule.
@Module({
  imports: [FilesModule, CareerModule],
  controllers: [PostsController],
  providers: [PostsService, PostLiveEvents],
  exports: [PostsService],
})
export class PostsModule {}
