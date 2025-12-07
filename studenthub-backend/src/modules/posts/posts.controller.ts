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
import { PostsService } from './posts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreatePostDto, UpdatePostDto, GetPostsDto } from './dto';
import { User } from '@prisma/client';

@ApiTags('Posts')
@ApiBearerAuth()
@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiResponse({ status: 201, description: 'Post created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createPost(
    @CurrentUser() user: User,
    @Body() dto: CreatePostDto,
  ) {
    return this.postsService.createPost(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get posts feed',
    description: 'Returns paginated feed of posts. Shows PUBLIC posts, FRIENDS_ONLY posts from friends, and user\'s own posts.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Posts retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPostsFeed(@Query() dto: GetPostsDto, @CurrentUser() user: User) {
    return this.postsService.getPostsFeed(dto, user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get post by ID',
    description: 'Returns post details with comments and reactions. Respects visibility settings.',
  })
  @ApiParam({ name: 'id', description: 'Post ID', type: String })
  @ApiResponse({ status: 200, description: 'Post retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Post is not visible to you' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async getPostById(@Param('id') id: string, @CurrentUser() user: User) {
    return this.postsService.getPostById(id, user.id);
  }

  @Get('users/:id/posts')
  @ApiOperation({
    summary: "Get user's posts",
    description: 'Returns paginated list of user\'s posts. Respects visibility settings and friendship status.',
  })
  @ApiParam({ name: 'id', description: 'User ID', type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Posts retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserPosts(
    @Param('id') userId: string,
    @Query() dto: GetPostsDto,
    @CurrentUser() user: User,
  ) {
    return this.postsService.getUserPosts(user.id, userId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update post (only author)' })
  @ApiResponse({ status: 200, description: 'Post updated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async updatePost(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postsService.updatePost(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete post (only author)' })
  @ApiResponse({ status: 200, description: 'Post deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async deletePost(@Param('id') id: string, @CurrentUser() user: User) {
    return this.postsService.deletePost(id, user.id);
  }
}

