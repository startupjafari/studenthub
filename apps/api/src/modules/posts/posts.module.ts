import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { CareerModule } from '../career/career.module'
import { ProfileContentModule } from '../profile-content/profile-content.module'
import { PostsService } from './posts.service'
import { PostsController } from './posts.controller'

// Посты и лента (docs/PROJECT.md §3.3, задачи Ф8). Владеет Post/Reaction/Comment.
// Медиа привязываются к File (posts-media) по File.postId; PrismaService/ConfigService — глобальные.
// FilesModule — presigned-URL к медиа поста (по видимости поста, FileService).
// CareerModule — посты страницы компании: её видимость и право публиковать от её имени.
@Module({
  imports: [FilesModule, CareerModule, ProfileContentModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
