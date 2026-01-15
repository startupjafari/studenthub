import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StoriesService } from './stories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateStoryDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Stories')
@ApiBearerAuth()
@Controller('stories')
@UseGuards(JwtAuthGuard)
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create story',
    description:
      'Creates a new 24-hour story. Story automatically expires after 24 hours. Media must be IMAGE or VIDEO type.',
  })
  @ApiResponse({ status: 201, description: 'Story created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input - Media must be image or video' })
  @ApiResponse({ status: 404, description: 'Media not found' })
  async createStory(@CurrentUser() user: User, @Body() dto: CreateStoryDto) {
    return this.storiesService.createStory(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get active stories (grouped by author)',
    description:
      'Returns active stories from user and their friends, grouped by author. Only shows stories that have not expired.',
  })
  @ApiResponse({ status: 200, description: 'Stories retrieved successfully' })
  async getActiveStories(@CurrentUser() user: User) {
    return this.storiesService.getActiveStories(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'View story (creates view record)',
    description:
      'Views a story and creates a view record. Sends notification to story author if not own story.',
  })
  @ApiParam({ name: 'id', description: 'Story ID', type: String })
  @ApiResponse({ status: 200, description: 'Story retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Story has expired' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async getStoryById(@Param('id') id: string, @CurrentUser() user: User) {
    return this.storiesService.getStoryById(id, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete story (only author)',
    description: 'Deletes a story. Only the story author can delete their own stories.',
  })
  @ApiParam({ name: 'id', description: 'Story ID', type: String })
  @ApiResponse({ status: 200, description: 'Story deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own stories' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async deleteStory(@Param('id') id: string, @CurrentUser() user: User) {
    return this.storiesService.deleteStory(id, user.id);
  }

  @Get(':id/views')
  @ApiOperation({
    summary: 'Get story views (only author)',
    description: 'Returns list of users who viewed the story. Only accessible to story author.',
  })
  @ApiParam({ name: 'id', description: 'Story ID', type: String })
  @ApiResponse({ status: 200, description: 'Views retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only view your own story views' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async getStoryViews(@Param('id') id: string, @CurrentUser() user: User) {
    return this.storiesService.getStoryViews(id, user.id);
  }
}
