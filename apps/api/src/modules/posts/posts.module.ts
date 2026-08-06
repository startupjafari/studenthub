import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { PostsService } from './posts.service'
import { PostsController } from './posts.controller'

// Посты и лента (docs/PROJECT.md §3.3, задачи Ф8). Владеет Post/Reaction/Comment.
// Медиа привязываются к File (posts-media) по File.postId; PrismaService/ConfigService — глобальные.
// FilesModule — presigned-URL к медиа поста (по видимости поста, FileService).
@Module({
  imports: [FilesModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
