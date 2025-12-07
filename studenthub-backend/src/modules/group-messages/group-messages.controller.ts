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
} from '@nestjs/swagger';
import { GroupMessagesService } from './group-messages.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GroupMemberGuard } from '../../common/guards/group-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateGroupMessageDto,
  GetGroupMessagesDto,
  UpdateGroupMessageDto,
} from './dto';
import { User } from '@prisma/client';

@ApiTags('Group Messages')
@ApiBearerAuth()
@Controller('groups/:id/messages')
@UseGuards(JwtAuthGuard, GroupMemberGuard)
export class GroupMessagesController {
  constructor(private readonly groupMessagesService: GroupMessagesService) {}

  @Post()
  @ApiOperation({
    summary: 'Send message to group (only members)',
    description: 'Sends a message to a group. Message is broadcasted to all group members via WebSocket.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Message must have content or media' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a member of this group' })
  async sendMessage(
    @Param('id') groupId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateGroupMessageDto,
  ) {
    return this.groupMessagesService.sendMessage(groupId, user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get group messages (only members)',
    description: 'Returns paginated list of group messages, sorted by creation date (newest first).',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 50, max: 100)' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a member of this group' })
  async getMessages(
    @Param('id') groupId: string,
    @CurrentUser() user: User,
    @Query() dto: GetGroupMessagesDto,
  ) {
    return this.groupMessagesService.getMessages(groupId, user.id, dto);
  }

  @Put(':msgId')
  @ApiOperation({
    summary: 'Update message (only author)',
    description: 'Updates group message content. Sets isEdited flag to true. Only the message author can update their own messages.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiParam({ name: 'msgId', description: 'Message ID', type: String })
  @ApiResponse({ status: 200, description: 'Message updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only edit your own messages' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async updateMessage(
    @Param('id') groupId: string,
    @Param('msgId') messageId: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateGroupMessageDto,
  ) {
    return this.groupMessagesService.updateMessage(
      groupId,
      messageId,
      user.id,
      dto,
    );
  }

  @Delete(':msgId')
  @ApiOperation({
    summary: 'Delete message (only author or ADMIN)',
    description: 'Soft deletes a group message. Can be deleted by message author or group ADMIN.',
  })
  @ApiParam({ name: 'id', description: 'Group ID', type: String })
  @ApiParam({ name: 'msgId', description: 'Message ID', type: String })
  @ApiResponse({ status: 200, description: 'Message deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own messages or be an admin' })
  @ApiResponse({ status: 404, description: 'Message not found' })
  async deleteMessage(
    @Param('id') groupId: string,
    @Param('msgId') messageId: string,
    @CurrentUser() user: User,
  ) {
    return this.groupMessagesService.deleteMessage(groupId, messageId, user.id);
  }
}

