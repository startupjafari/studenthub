import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { UsersModule } from '../users/users.module'
import { PollsModule } from '../polls/polls.module'
import { ProfileContentService } from './profile-content.service'
import { ProfileContentController } from './profile-content.controller'

// Контент профиля (вкладки: Фото/Видео, Статьи, Вопрос-ответ).
// Владеет ProfileArticle/ProfileQa; фото/видео — бакет profile-media через FileService.
// PollsModule — число опросов автора для счётчиков вкладок (таблица опросов — его).
@Module({
  imports: [FilesModule, UsersModule, PollsModule],
  controllers: [ProfileContentController],
  providers: [ProfileContentService],
  exports: [ProfileContentService],
})
export class ProfileContentModule {}
