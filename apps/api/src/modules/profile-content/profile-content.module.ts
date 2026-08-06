import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { ProfileContentService } from './profile-content.service'
import { ProfileContentController } from './profile-content.controller'

// Контент профиля (вкладки: Фото/Видео, Статьи, Вопрос-ответ).
// Владеет ProfileArticle/ProfileQa; фото/видео — бакет profile-media через FileService.
@Module({
  imports: [FilesModule],
  controllers: [ProfileContentController],
  providers: [ProfileContentService],
  exports: [ProfileContentService],
})
export class ProfileContentModule {}
