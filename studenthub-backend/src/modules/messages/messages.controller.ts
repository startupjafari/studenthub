import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMessageDto, GetMessagesDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Messages')
@ApiBearerAuth()
@Controller('conversations/:id/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @ApiOperation({
    summary: 'Send message in conversation',
    description: 'Sends a message in a conversation. Updates conversation lastMessage and sends notifications to other participants via WebSocket.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Message must have content or media' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a participant of this conversation' })
  @ApiResponse({ status: 404, description: 'Conversation or media not found' })
  async sendMessage(
    @Param('id') conversationId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.sendMessage(conversationId, user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get messages in conversation',
    description: 'Returns paginated list of messages in a conversation, sorted by creation date (newest first).',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 50, max: 100)' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a participant of this conversation' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getMessages(
    @Param('id') conversationId: string,
    @CurrentUser() user: User,
    @Query() dto: GetMessagesDto,
  ) {
    return this.messagesService.getMessages(conversationId, user.id, dto);
  }

  @Put(':msgId')
  @ApiOperation({
    summary: 'Update message (only author)',
    description: 'Updates message content. Sets isEdited flag to true. Only the message author can update their own messages.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiParam({ name: 'msgId', description: 'Message ID', type: String })
  @ApiBody({ schema: { type: 'object', properties: { content: { type: 'string' } } } })
  @ApiResponse({ status: 200, description: 'Message updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only edit your own messages' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async updateMessage(
    @Param('msgId') messageId: string,
    @CurrentUser() user: User,
    @Body('content') content: string,
  ) {
    return this.messagesService.updateMessage(messageId, user.id, content);
  }

  @Delete(':msgId')
  @ApiOperation({
    summary: 'Delete message (only author)',
    description: 'Soft deletes a message (sets isDeleted flag to true). Only the message author can delete their own messages.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiParam({ name: 'msgId', description: 'Message ID', type: String })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own messages' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async deleteMessage(
    @Param('msgId') messageId: string,
    @CurrentUser() user: User,
  ) {
    return this.messagesService.deleteMessage(messageId, user.id);
  }
}

