import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FileBucketKind } from '@studenthub/shared-schemas'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from './file.service'
import { UploadFileDto } from './dto/upload-file.dto'

// Логический вид бакета → имя переменной окружения с реальным именем бакета.
const BUCKET_ENV: Record<FileBucketKind, keyof EnvVars> = {
  AVATARS: 'MINIO_BUCKET_AVATARS',
  POSTS: 'MINIO_BUCKET_POSTS',
  STORIES: 'MINIO_BUCKET_STORIES',
  APPLICATIONS: 'MINIO_BUCKET_APPLICATIONS',
}

@ApiTags('Файлы')
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FileService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить файл (multipart) в указанный бакет' })
  async upload(
    @CurrentUser() user: CurrentUserData,
    @Query() query: UploadFileDto,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await readSingleUpload(req)

    // Все MINIO_BUCKET_* — строки; динамический ключ даёт union, сужаем явно.
    const bucket = this.config.get(BUCKET_ENV[query.bucket], { infer: true }) as string
    return this.files.upload({ buffer, bucket, ownerId: user.sub })
  }

  @Get(':id/presigned')
  @ApiOperation({ summary: 'Presigned URL к своему файлу (TTL 15 мин)' })
  async presigned(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    const url = await this.files.getPresignedUrl(id, user.sub)
    return { url }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить свой файл (объект в MinIO + запись)' })
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.files.delete(id, user.sub)
  }
}
