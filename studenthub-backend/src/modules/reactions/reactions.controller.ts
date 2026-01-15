import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ReactionsService } from './reactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateReactionDto } from './dto';
import { User, ReactionType } from '@prisma/client';

@ApiTags('Reactions')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  // Post reactions
  @Post('posts/:id/reactions')
  @ApiOperation({
    summary: 'Add reaction to post',
    description:
      'Adds a reaction (LIKE, LOVE, HAHA, WOW, SAD, ANGRY) to a post. Sends notification to post author.',
  })
  @ApiParam({ name: 'id', description: 'Post ID', type: String })
  @ApiResponse({ status: 201, description: 'Reaction added successfully' })
  @ApiResponse({ status: 400, description: 'Reaction already exists' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async addPostReaction(
    @Param('id') postId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateReactionDto,
  ) {
    return this.reactionsService.addPostReaction(postId, user.id, dto);
  }

  @Delete('posts/:id/reactions/:type')
  @ApiOperation({
    summary: 'Remove reaction from post',
    description: 'Removes a specific reaction type from a post.',
  })
  @ApiParam({ name: 'id', description: 'Post ID', type: String })
  @ApiParam({ name: 'type', enum: ReactionType, description: 'Reaction type' })
  @ApiResponse({ status: 200, description: 'Reaction removed successfully' })
  @ApiResponse({ status: 404, description: 'Reaction not found' })
  async removePostReaction(
    @Param('id') postId: string,
    @Param('type') type: ReactionType,
    @CurrentUser() user: User,
  ) {
    return this.reactionsService.removePostReaction(postId, user.id, type);
  }

  @Get('posts/:id/reactions')
  @ApiOperation({
    summary: 'Get reactions for post',
    description: 'Returns reactions grouped by type with counts and list of users who reacted.',
  })
  @ApiParam({ name: 'id', description: 'Post ID', type: String })
  @ApiResponse({ status: 200, description: 'Reactions retrieved successfully' })
  async getPostReactions(@Param('id') postId: string) {
    return this.reactionsService.getPostReactions(postId);
  }

  // Comment reactions
  @Post('comments/:id/reactions')
  @ApiOperation({
    summary: 'Add reaction to comment',
    description: 'Adds a reaction to a comment.',
  })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiResponse({ status: 201, description: 'Reaction added successfully' })
  @ApiResponse({ status: 400, description: 'Reaction already exists' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async addCommentReaction(
    @Param('id') commentId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateReactionDto,
  ) {
    return this.reactionsService.addCommentReaction(commentId, user.id, dto);
  }

  @Delete('comments/:id/reactions/:type')
  @ApiOperation({
    summary: 'Remove reaction from comment',
    description: 'Removes a specific reaction type from a comment.',
  })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiParam({ name: 'type', enum: ReactionType, description: 'Reaction type' })
  @ApiResponse({ status: 200, description: 'Reaction removed successfully' })
  @ApiResponse({ status: 404, description: 'Reaction not found' })
  async removeCommentReaction(
    @Param('id') commentId: string,
    @Param('type') type: ReactionType,
    @CurrentUser() user: User,
  ) {
    return this.reactionsService.removeCommentReaction(commentId, user.id, type);
  }

  @Get('comments/:id/reactions')
  @ApiOperation({
    summary: 'Get reactions for comment',
    description: 'Returns reactions grouped by type with counts and list of users who reacted.',
  })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiResponse({ status: 200, description: 'Reactions retrieved successfully' })
  async getCommentReactions(@Param('id') commentId: string) {
    return this.reactionsService.getCommentReactions(commentId);
  }
}
