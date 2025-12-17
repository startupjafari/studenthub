import {
  Controller,
  Get,
  Post,
  Param,
  Query,
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
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateTagDto, GetTagsDto } from './dto';

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new tag' })
  @ApiResponse({ status: 201, description: 'Tag created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async createTag(@Body() dto: CreateTagDto) {
    return this.tagsService.createOrGetTag(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tags with pagination' })
  @ApiResponse({ status: 200, description: 'Tags retrieved' })
  async getTags(@Query() dto: GetTagsDto) {
    return this.tagsService.getTags(dto);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Get trending tags' })
  @ApiResponse({ status: 200, description: 'Trending tags retrieved' })
  async getTrendingTags(@Query('limit') limit?: number) {
    return this.tagsService.getTrendingTags(limit ? parseInt(limit.toString()) : 10);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get tag by slug' })
  @ApiParam({ name: 'slug', description: 'Tag slug' })
  @ApiResponse({ status: 200, description: 'Tag retrieved' })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  async getTagBySlug(@Param('slug') slug: string) {
    return this.tagsService.getTagBySlug(slug);
  }
}


