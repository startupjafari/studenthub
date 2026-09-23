import {
  Body,
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
import { Throttle } from '@nestjs/throttler'
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FileBucketKind } from '@studenthub/shared-schemas'
import type { FastifyRequest } from 'fastify'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import type { EnvVars } from '../../config/env.schema'
import { FileService } from './file.service'
import { UploadFileDto } from './dto/upload-file.dto'
import { ConfirmUploadDto, PresignUploadDto } from './dto/presign-upload.dto'
import {
  MultipartAbortDto,
  MultipartCompleteDto,
  MultipartStartDto,
  MultipartUrlsDto,
} from './dto/multipart-upload.dto'

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

    return this.files.upload({ buffer, bucket: this.bucketName(query.bucket), ownerId: user.sub })
  }

  /** Все MINIO_BUCKET_* — строки; динамический ключ даёт union, сужаем явно. */
  private bucketName(kind: FileBucketKind): string {
    return this.config.get(BUCKET_ENV[kind], { infer: true }) as string
  }

  @Post('presign')
  // Подписанная ссылка не ограничивает размер объекта: MinIO примет по ней сколько угодно,
  // а лимит категории проверяется только на `confirm` — то есть загрузку, которую никто не
  // подтвердил, до ночной cleanOrphanFiles оплачивает хранилище. Пока размер не ограничен
  // самой подписью, потолок ставим на выдачу ссылок: 60 в минуту с запасом покрывают
  // реальную загрузку альбома и делают бессмысленным залив мусора пачками.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ссылка для прямой загрузки файла больше порога буферной (шаг 1 из 3)',
  })
  @ApiResponse({ status: 201, description: 'key + подписанный PUT-URL + срок действия' })
  async presign(@CurrentUser() user: CurrentUserData, @Body() dto: PresignUploadDto) {
    return this.files.presignPut(this.bucketName(dto.bucket), dto.mime, user.sub)
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Подтвердить прямую загрузку — сервер проверит объект и создаст File (шаг 3 из 3)',
  })
  @ApiResponse({ status: 201, description: 'Запись File' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — объект не загружен' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  async confirm(@CurrentUser() user: CurrentUserData, @Body() dto: ConfirmUploadDto) {
    return this.files.confirmDirectUpload({
      bucket: this.bucketName(dto.bucket),
      key: dto.key,
      ownerId: user.sub,
      name: dto.name,
    })
  }

  // ── Многочастная загрузка (Фаза 19) ────────────────────────────────────────
  // Файлы больше FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES: start → urls → PUT частей → complete.
  // Троттлинг тот же, что у одиночного presign, и по той же причине: подписанная ссылка не
  // ограничивает размер объекта, а за незавершённые загрузки платит хранилище.

  @Post('multipart/start')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Открыть многочастную загрузку крупного файла (шаг 1 из 4)' })
  @ApiResponse({ status: 201, description: 'key + uploadId + размер и число частей' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — файл или число частей за пределом' })
  async multipartStart(@CurrentUser() user: CurrentUserData, @Body() dto: MultipartStartDto) {
    return this.files.startMultipart({
      bucket: this.bucketName(dto.bucket),
      mime: dto.mime,
      size: dto.size,
      ownerId: user.sub,
    })
  }

  @Post('multipart/urls')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Подписанные ссылки на диапазон частей (шаг 2 из 4)' })
  @ApiResponse({ status: 201, description: 'Ссылки по номерам частей + срок действия' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  async multipartUrls(@CurrentUser() user: CurrentUserData, @Body() dto: MultipartUrlsDto) {
    return this.files.presignParts({
      bucket: this.bucketName(dto.bucket),
      key: dto.key,
      uploadId: dto.uploadId,
      ownerId: user.sub,
      from: dto.from,
      to: dto.to,
    })
  }

  @Post('multipart/complete')
  @ApiOperation({ summary: 'Собрать файл из частей и создать File (шаг 4 из 4)' })
  @ApiResponse({ status: 201, description: 'Запись File' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — части не сходятся' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  async multipartComplete(@CurrentUser() user: CurrentUserData, @Body() dto: MultipartCompleteDto) {
    return this.files.completeMultipart({
      bucket: this.bucketName(dto.bucket),
      key: dto.key,
      uploadId: dto.uploadId,
      ownerId: user.sub,
      parts: dto.parts,
      name: dto.name,
    })
  }

  @Post('multipart/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отменить многочастную загрузку — MinIO удалит залитые части' })
  async multipartAbort(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MultipartAbortDto,
  ): Promise<void> {
    await this.files.abortMultipart({
      bucket: this.bucketName(dto.bucket),
      key: dto.key,
      uploadId: dto.uploadId,
      ownerId: user.sub,
    })
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
