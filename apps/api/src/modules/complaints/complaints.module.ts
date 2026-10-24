import { Module } from '@nestjs/common'
import { UsersModule } from '../users/users.module'
import { StoriesModule } from '../stories/stories.module'
import { PostsModule } from '../posts/posts.module'
import { ComplaintsService } from './complaints.service'
import { ComplaintsController } from './complaints.controller'

// Жалобы и модерация (docs/PROJECT.md §11, задачи Ф11). Владеет Complaint.
// UsersModule — UserService.setBlocked для блокировки нарушителя. QueueService — уведомление автору.
// StoriesModule — снос сторис по решению модерации: мягкого удаления у неё нет, а объект
// в MinIO убирает владелец домена (§2.1). PostsModule и StoriesModule — ещё и видимость цели:
// жалоба на невидимый автору контент отвечает так же, как на несуществующий.
@Module({
  imports: [UsersModule, StoriesModule, PostsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
