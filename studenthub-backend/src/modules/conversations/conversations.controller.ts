import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateConversationDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create or get existing conversation',
    description: 'Creates a new conversation or returns existing one. For PRIVATE: returns existing if found. For GROUP: creates new group conversation.',
  })
  @ApiResponse({ status: 201, description: 'Conversation created or retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input - Private conversation must have 1 participant' })
  async createConversation(
    @CurrentUser() user: User,
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversationsService.createConversation(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get my conversations',
    description: 'Returns all conversations where user is a participant, sorted by last message date.',
  })
  @ApiResponse({ status: 200, description: 'Conversations retrieved successfully' })
  async getMyConversations(@CurrentUser() user: User) {
    return this.conversationsService.getMyConversations(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get conversation by ID (only participants)',
    description: 'Returns conversation details including participants and last message. Only accessible to conversation participants.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiResponse({ status: 200, description: 'Conversation retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a participant of this conversation' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationById(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.conversationsService.getConversationById(id, user.id);
  }

  @Patch(':id/archive')
  @ApiOperation({
    summary: 'Archive conversation',
    description: 'Archives a conversation. Archived conversations can be filtered out in the UI.',
  })
  @ApiParam({ name: 'id', description: 'Conversation ID', type: String })
  @ApiResponse({ status: 200, description: 'Conversation archived successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You are not a participant' })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async archiveConversation(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    return this.conversationsService.archiveConversation(id, user.id);
  }
}

