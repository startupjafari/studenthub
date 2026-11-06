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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readNamedUpload } from '../../common/http/read-upload'
import type { RequestContext } from '../auth/auth.service'
import { MaterialsService } from './materials.service'
import { ConfirmMaterialFileDto, PresignMaterialFileDto } from './dto/presign-material-file.dto'
import {
  MaterialFileMultipartAbortDto,
  MaterialFileMultipartCompleteDto,
  MaterialFileMultipartStartDto,
  MaterialFileMultipartUrlsDto,
} from './dto/material-file-multipart.dto'
import { CreateMaterialDto } from './dto/create-material.dto'
import { MaterialListQueryDto, MaterialSubjectsQueryDto } from './dto/material-list-query.dto'

const AUTHOR_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const

@ApiTags('Материалы')
@ApiBearerAuth()
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @ApiOperation({ summary: 'Учебные материалы по scope (студент — своя группа)' })
  @ApiResponse({
    status: 200,
    description:
      'Без page — массив (cursor, limit ≤ 200, свежие сверху). С page — страница (limit ≤ 100, sort title|subject|teacher|files|createdAt, order) и meta.total',
  })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — page вместе с cursor' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: MaterialListQueryDto) {
    return this.materials.list(user, query)
  }

  @Get('subjects')
  @ApiOperation({ summary: 'Число материалов по дисциплинам (тот же scope, что у списка)' })
  subjects(@CurrentUser() user: CurrentUserData, @Query() query: MaterialSubjectsQueryDto) {
    return this.materials.subjects(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать материал для группы' })
  @ApiResponse({ status: 201, description: 'Материал создан' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateMaterialDto,
    @Req() req: FastifyRequest,
  ) {
    return this.materials.create(user, dto, this.ctx(req))
  }

  @Post(':id/files/presign')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Прямая загрузка крупного файла: подписанная ссылка (шаг 1 из 3)' })
  @ApiResponse({ status: 201, description: 'key + PUT-URL + срок действия' })
  presignFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PresignMaterialFileDto,
  ) {
    return this.materials.presignFile(user, id, dto.mime)
  }

  @Post(':id/files/confirm')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Подтвердить прямую загрузку файла материала (шаг 3 из 3)' })
  @ApiResponse({ status: 201, description: 'Файл прикреплён к материалу' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  confirmFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ConfirmMaterialFileDto,
    @Req() req: FastifyRequest,
  ) {
    return this.materials.confirmFile(user, id, dto.key, dto.name, this.ctx(req))
  }

  // ── Многочастная загрузка (21.B1) ──────────────────────────────────────────
  // Файлы больше FILE_UPLOAD.MULTIPART_THRESHOLD_BYTES: start → urls → PUT частей → complete.
  // Троттлинг выдачи подписей — как у /files/multipart/* и вложений чата.

  @Post(':id/files/multipart/start')
  @Roles(...AUTHOR_ROLES)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Открыть многочастную загрузку файла материала (шаг 1 из 4)' })
  @ApiResponse({ status: 201, description: 'key + uploadId + размер и число частей' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — файл или число частей за пределом' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — нет прав на материал' })
  @ApiResponse({ status: 409, description: 'CONFLICT — у материала уже предельное число файлов' })
  startFileMultipart(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MaterialFileMultipartStartDto,
  ) {
    return this.materials.startFileMultipart(user, id, dto.mime, dto.size)
  }

  @Post(':id/files/multipart/urls')
  @Roles(...AUTHOR_ROLES)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Подписи на диапазон частей файла материала (шаг 2 из 4)' })
  @ApiResponse({ status: 201, description: 'Ссылки по номерам частей + срок действия' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — нет прав или ключ не свой' })
  fileMultipartUrls(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MaterialFileMultipartUrlsDto,
  ) {
    return this.materials.fileMultipartUrls(user, id, {
      key: dto.key,
      uploadId: dto.uploadId,
      from: dto.from,
      to: dto.to,
    })
  }

  @Post(':id/files/multipart/complete')
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Собрать файл материала из частей и прикрепить (шаг 4 из 4)' })
  @ApiResponse({ status: 201, description: 'Файл прикреплён к материалу' })
  @ApiResponse({ status: 400, description: 'BAD_REQUEST — части не сходятся' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — нет прав или ключ не свой' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  completeFileMultipart(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MaterialFileMultipartCompleteDto,
    @Req() req: FastifyRequest,
  ) {
    return this.materials.completeFileMultipart(user, id, dto, this.ctx(req))
  }

  @Post(':id/files/multipart/abort')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Отменить многочастную загрузку файла материала' })
  @ApiResponse({ status: 204, description: 'Залитые части удалены' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не свой' })
  async abortFileMultipart(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: MaterialFileMultipartAbortDto,
  ): Promise<void> {
    await this.materials.abortFileMultipart(user, { key: dto.key, uploadId: dto.uploadId })
  }

  @Post(':id/files')
  @Roles(...AUTHOR_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Прикрепить файл к материалу (автор/админ)' })
  async addFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const { buffer, filename } = await readNamedUpload(req)
    return this.materials.addFile(user, id, buffer, filename, this.ctx(req))
  }

  @Get(':id/files/:fileId/presigned')
  @ApiOperation({ summary: 'Presigned URL к файлу материала (по scope)' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt, …MediaInfo } — оригинал и варианты' })
  fileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.materials.getFileUrl(user, id, fileId)
  }

  @Delete(':id')
  @Roles(...AUTHOR_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить материал (автор/админ)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.materials.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
