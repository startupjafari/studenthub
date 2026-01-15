import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UploadMediaDto } from './dto';
import { User, MediaType } from '@prisma/client';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload media file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        type: {
          type: 'string',
          enum: Object.values(MediaType),
          example: MediaType.IMAGE,
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Media uploaded' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadMediaDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    return this.mediaService.uploadMedia(user.id, file, dto.type);
  }

  @Get(':id')
  @Public()
  @ApiOperation({
    summary: 'Get media (returns signed URL)',
    description:
      'Returns media information with a signed URL for temporary access. Images are automatically optimized.',
  })
  @ApiParam({ name: 'id', description: 'Media ID', type: String })
  @ApiQuery({
    name: 'expiresIn',
    required: false,
    type: Number,
    description: 'URL expiration in seconds (default: 3600)',
  })
  @ApiResponse({ status: 200, description: 'Media retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Media not found' })
  async getMedia(@Param('id') id: string, @Query('expiresIn') expiresIn?: number) {
    return this.mediaService.getMedia(id, expiresIn ? Number(expiresIn) : 3600);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete media (only owner)',
    description: 'Deletes media from S3 and database. Only media owner or admins can delete media.',
  })
  @ApiParam({ name: 'id', description: 'Media ID', type: String })
  @ApiResponse({ status: 200, description: 'Media deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - You can only delete your own media' })
  @ApiResponse({ status: 404, description: 'Media not found' })
  async deleteMedia(@Param('id') id: string, @CurrentUser() user: User) {
    return this.mediaService.deleteMedia(id, user.id);
  }
}
