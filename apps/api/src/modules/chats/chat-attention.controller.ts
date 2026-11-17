import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ChatAttentionKind } from '@prisma/client'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ChatAttentionService } from './chat-attention.service'
import { ChatAttentionReadDto } from './dto/chat-attention-read.dto'

// Непрочитанные упоминания и реакции чата (Telegram: кнопки «@» и «♥» над «вниз»).
// Счётчики — в элементе списка (GET /chats: unreadMentionsCount / unreadReactionsCount) и
// событием `chat:attention` своим устройствам (docs/PROJECT.md §9.2).
@ApiTags('Чаты')
@ApiBearerAuth()
@Controller('chats')
export class ChatAttentionController {
  constructor(private readonly attention: ChatAttentionService) {}

  @Get(':id/mentions/unread')
  @ApiOperation({
    summary: 'Непрочитанные упоминания меня и ответы мне в чате (старые первыми, ≤ 100)',
  })
  @ApiResponse({ status: 200, description: '{ items: [{ messageId, seq, createdAt }], count }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  unreadMentions(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.attention.listUnread(user.sub, id, ChatAttentionKind.MENTION)
  }

  @Post(':id/mentions/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Прочитать упоминания: показанные (messageIds) или все; chat:attention своим устройствам',
  })
  @ApiResponse({ status: 200, description: '{ unreadMentionsCount, unreadReactionsCount }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  readMentions(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatAttentionReadDto,
  ) {
    return this.attention.markRead(user.sub, id, ChatAttentionKind.MENTION, dto.messageIds)
  }

  @Get(':id/reactions/unread')
  @ApiOperation({
    summary: 'Мои сообщения с непрочитанными чужими реакциями в чате (старые первыми, ≤ 100)',
  })
  @ApiResponse({ status: 200, description: '{ items: [{ messageId, seq, createdAt }], count }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  unreadReactions(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.attention.listUnread(user.sub, id, ChatAttentionKind.REACTION)
  }

  @Post(':id/reactions/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Прочитать реакции: показанные (messageIds) или все; chat:attention своим устройствам',
  })
  @ApiResponse({ status: 200, description: '{ unreadMentionsCount, unreadReactionsCount }' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE — не участник' })
  readReactions(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ChatAttentionReadDto,
  ) {
    return this.attention.markRead(user.sub, id, ChatAttentionKind.REACTION, dto.messageIds)
  }
}
