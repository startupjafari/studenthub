import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
import { PostsModule } from '../posts/posts.module'
import { ChatsService } from './chats.service'
import { ChatsController } from './chats.controller'
import { ChatFoldersService } from './chat-folders.service'
import { ChatFoldersController } from './chat-folders.controller'
import { ChatGateway } from './chats.gateway'
import { LinkPreviewProcessor } from './link-preview.processor'
import { LinkPreviewService } from '../../common/link-preview/link-preview.service'

// Чаты (docs/PROJECT.md §3.6, задачи Ф9). Владеет Chat/ChatMember/Message.
// ChatGateway навешивает WS-события на общий socket.io-сервер (handshake — в RealtimeGateway).
// QueueService (job new-message) — из глобального QueueModule. FilesModule — вложения (FileService).
@Module({
  imports: [FilesModule, PostsModule],
  // ChatFoldersController — первым: путь `chats/folders` не должен попасть в `chats/:id`.
  controllers: [ChatFoldersController, ChatsController],
  providers: [
    ChatsService,
    ChatFoldersService,
    ChatGateway,
    LinkPreviewProcessor,
    LinkPreviewService,
  ],
  exports: [ChatsService],
})
export class ChatsModule {}
