import { Module } from '@nestjs/common'
import { StoriesModule } from '../stories/stories.module'
import { FilesModule } from '../files/files.module'
import { PostsModule } from '../posts/posts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { FriendsRealtimeModule } from '../friends/friends-realtime.module'
import { ChatsService } from './chats.service'
import { SupportController } from './support.controller'
import { SupportService } from './support.service'
import { ChatsController } from './chats.controller'
import { ChatFoldersService } from './chat-folders.service'
import { ChatFoldersController } from './chat-folders.controller'
import { ChatSettingsService } from './chat-settings.service'
import { ChatSettingsController } from './chat-settings.controller'
import { ChatGateway } from './chats.gateway'
import { LinkPreviewProcessor } from './link-preview.processor'
import { LinkPreviewService } from '../../common/link-preview/link-preview.service'
import { ChatChecklistsService } from './chat-checklists.service'
import { ChatChecklistsController } from './chat-checklists.controller'
import { ChatAttentionService } from './chat-attention.service'
import { ChatAttentionController } from './chat-attention.controller'
import { ChatLinkPreviewController } from './chat-link-preview.controller'
import { ChatLinkPreviewService } from './chat-link-preview.service'
import { ChatGroupsService } from './chat-groups.service'
import { ChatGroupsController } from './chat-groups.controller'

// Чаты (docs/PROJECT.md §3.6, задачи Ф9). Владеет Chat/ChatMember/Message.
// ChatGateway навешивает WS-события на общий socket.io-сервер (handshake — в RealtimeGateway).
// QueueService (job new-message) — из глобального QueueModule. FilesModule — вложения (FileService).
// FriendsRealtimeModule — сигнал «дружба удалена» второй стороне при блокировке (§9.2d).
@Module({
  imports: [FilesModule, PostsModule, NotificationsModule, StoriesModule, FriendsRealtimeModule],
  // Контроллеры со статическим префиксом (`chats/folders`, `chats/checklists`,
  // `chats/settings`, `chats/link-preview`) — первыми: их пути не должны попасть в `chats/:id`.
  controllers: [
    ChatFoldersController,
    ChatChecklistsController,
    ChatAttentionController,
    ChatSettingsController,
    ChatLinkPreviewController,
    ChatsController,
    ChatGroupsController,
    SupportController,
  ],
  providers: [
    ChatsService,
    ChatFoldersService,
    ChatGateway,
    LinkPreviewProcessor,
    LinkPreviewService,
    ChatLinkPreviewService,
    SupportService,
    ChatChecklistsService,
    ChatAttentionService,
    ChatSettingsService,
    ChatGroupsService,
  ],
  exports: [ChatsService, SupportService],
})
export class ChatsModule {}
