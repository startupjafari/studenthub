import { Controller, Get, Put, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { MentionsService } from './mentions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GetMentionsDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Mentions')
@ApiBearerAuth()
@Controller('mentions')
@UseGuards(JwtAuthGuard)
export class MentionsController {
  constructor(private readonly mentionsService: MentionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get user mentions' })
  @ApiResponse({ status: 200, description: 'Mentions retrieved' })
  async getMentions(@CurrentUser() user: User, @Query() dto: GetMentionsDto) {
    return this.mentionsService.getUserMentions(user.id, dto);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread mentions count' })
  @ApiResponse({ status: 200, description: 'Unread count retrieved' })
  async getUnreadCount(@CurrentUser() user: User) {
    return this.mentionsService.getUnreadCount(user.id);
  }

  @Put(':id/read')
  @ApiOperation({ summary: 'Mark mention as read' })
  @ApiParam({ name: 'id', description: 'Mention ID' })
  @ApiResponse({ status: 200, description: 'Mention marked as read' })
  @ApiResponse({ status: 404, description: 'Mention not found' })
  async markAsRead(@Param('id') mentionId: string, @CurrentUser() user: User) {
    return this.mentionsService.markAsRead(mentionId, user.id);
  }
}
