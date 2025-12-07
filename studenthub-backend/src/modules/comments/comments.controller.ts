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
import { CommentsService } from './comments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateCommentDto, UpdateCommentDto, GetCommentsDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Comments')
@ApiBearerAuth()
@Controller('posts/:postId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Add comment to post',
    description: 'Creates a new comment on a post. Automatically sends notification to post author.',
  })
  @ApiParam({ name: 'postId', description: 'Post ID', type: String })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input or media not found' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async createComment(
    @Param('postId') postId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.createComment(postId, user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get comments for post',
    description: 'Returns paginated list of comments for a post, sorted by creation date (oldest first).',
  })
  @ApiParam({ name: 'postId', description: 'Post ID', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Comments retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getComments(
    @Param('postId') postId: string,
    @Query() dto: GetCommentsDto,
  ) {
    return this.commentsService.getComments(postId, dto);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update comment (only author)',
    description: 'Updates comment content. Only the comment author can update their own comments.',
  })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiResponse({ status: 200, description: 'Comment updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only edit your own comments' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async updateComment(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.updateComment(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete comment (only author)',
    description: 'Deletes a comment. Only the comment author can delete their own comments.',
  })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own comments' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async deleteComment(@Param('id') id: string, @CurrentUser() user: User) {
    return this.commentsService.deleteComment(id, user.id);
  }
}

