import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { EventsModule } from '../events/events.module'
import { PostsModule } from '../posts/posts.module'
import { SchedulesModule } from '../schedules/schedules.module'
import { StoriesService } from './stories.service'
import { StoriesController } from './stories.controller'
import { StoryHighlightsService } from './story-highlights.service'
import { StoryHighlightsController } from './story-highlights.controller'

// Сторисы (docs/PROJECT.md §3.4, задача Ф14.1). Владеет Story/StoryPoll/StoryView/StoryReaction.
// Медиа лежит в бакете stories-media и привязано через Story.fileId; FilesModule нужен для
// presigned-ссылок и удаления объекта вместе со сторис. Сервис экспортируется для
// CleanupService (крон deleteExpiredStories) и ComplaintsService (жалобы на сторис).
// «Актуальное» (StoryHighlight/StoryHighlightItem) — здесь же: снимки сторис с копией медиа.
@Module({
  // События, посты и расписание — для карточек-стикеров: видимость решают их модули.
  imports: [FilesModule, EventsModule, PostsModule, SchedulesModule],
  // Подборки — первыми: их статичный префикс не должен зависеть от порядка регистрации.
  controllers: [StoryHighlightsController, StoriesController],
  providers: [StoriesService, StoryHighlightsService],
  exports: [StoriesService],
})
export class StoriesModule {}
