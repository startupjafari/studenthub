import { Module } from '@nestjs/common'
import { StoriesModule } from '../stories/stories.module'
import { FilesModule } from '../files/files.module'
import { PostsModule } from '../posts/posts.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { ChatsService } from './chats.service'
import { SupportController } from './support.controller'
import { SupportService } from './support.service'
import { ChatsController } from './chats.controller'
import { ChatFoldersService } from './chat-folders.service'
import { ChatFoldersController } from './chat-folders.controller'
import { ChatGateway } from './chats.gateway'
import { LinkPreviewProcessor } from './link-preview.processor'
import { LinkPreviewService } from '../../common/link-preview/link-preview.service'
import { ChatChecklistsService } from './chat-checklists.service'
import { ChatChecklistsController } from './chat-checklists.controller'
import { ChatStickersService } from './chat-stickers.service'
import { ChatStickersController } from './chat-stickers.controller'
import { StickerSetsAdminController } from './sticker-sets-admin.controller'
import { ChatGifsService } from './chat-gifs.service'
import { ChatGifsController } from './chat-gifs.controller'

// Чаты (docs/PROJECT.md §3.6, задачи Ф9). Владеет Chat/ChatMember/Message.
// ChatGateway навешивает WS-события на общий socket.io-сервер (handshake — в RealtimeGateway).
// QueueService (job new-message) — из глобального QueueModule. FilesModule — вложения (FileService).
@Module({
  imports: [FilesModule, PostsModule, NotificationsModule, StoriesModule],
  // Контроллеры со статическим префиксом (`chats/folders`, `chats/checklists`,
  // `chats/stickers`, `chats/gifs`) — первыми: их пути не должны попасть в `chats/:id`.
  controllers: [
    ChatFoldersController,
    ChatChecklistsController,
    ChatStickersController,
    ChatGifsController,
    ChatsController,
    SupportController,
    StickerSetsAdminController,
  ],
  providers: [
    ChatsService,
    ChatFoldersService,
    ChatGateway,
    LinkPreviewProcessor,
    LinkPreviewService,
    SupportService,
    ChatChecklistsService,
    ChatStickersService,
    ChatGifsService,
  ],
  exports: [ChatsService, SupportService],
})
export class ChatsModule {}
