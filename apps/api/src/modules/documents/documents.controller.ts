import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { readSingleUpload } from '../../common/http/read-upload'
import { DocumentsService } from './documents.service'
import { ConfirmDocumentFileDto, PresignDocumentFileDto } from './dto/presign-document-file.dto'
import { CreateDocumentDto } from './dto/create-document.dto'
import { UpdateDocumentDto } from './dto/update-document.dto'
import { DocumentListQueryDto } from './dto/document-list-query.dto'
import { DocumentFilesDto } from './dto/document-files.dto'
import { GrantAccessDto } from './dto/grant-access.dto'
import { PlatformAccessDto } from './dto/platform-access.dto'

// Модуль «Документы» (Ф15): личное защищённое хранилище. Полный номер наружу не отдаётся.
@ApiTags('Документы')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Загрузить файл документа (PDF/JPG/PNG) — вернёт id для прикрепления' })
  async upload(@CurrentUser() user: CurrentUserData, @Req() req: FastifyRequest) {
    const buffer = await readSingleUpload(req)
    return this.documents.uploadFile(user, buffer)
  }

  @Post('upload/presign')
  @ApiOperation({
    summary: 'Прямая загрузка крупного скана: подписанная ссылка (шаг 1 из 3)',
  })
  @ApiResponse({ status: 201, description: 'key + PUT-URL + срок действия' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED — только PDF/JPG/PNG' })
  presignUpload(@CurrentUser() user: CurrentUserData, @Body() dto: PresignDocumentFileDto) {
    return this.documents.presignFile(user, dto.mime)
  }

  @Post('upload/confirm')
  @ApiOperation({
    summary: 'Подтвердить прямую загрузку — вернёт id файла для прикрепления (шаг 3 из 3)',
  })
  @ApiResponse({ status: 201, description: 'id, реальный mime и размер' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  confirmUpload(@CurrentUser() user: CurrentUserData, @Body() dto: ConfirmDocumentFileDto) {
    return this.documents.confirmFile(user, dto.key, dto.name)
  }

  @Post()
  @ApiOperation({ summary: 'Создать документ (метаданные; файлы прикрепляются отдельно)' })
  @ApiResponse({ status: 201, description: 'Документ создан' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateDocumentDto) {
    return this.documents.create(user, dto)
  }

  @Get()
  @ApiOperation({ summary: 'Мои документы (фильтры/поиск/сортировка; view=active|archived)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: DocumentListQueryDto) {
    return this.documents.list(user, query)
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Счётчики обзора (всего/нужно загрузить/на проверке/скоро истекает/требует замены)',
  })
  overview(@CurrentUser() user: CurrentUserData) {
    return this.documents.overview(user)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Документ по id (владелец)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.getById(user, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить данные документа' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documents.update(user, id, dto)
  }

  @Post(':id/files')
  @ApiOperation({ summary: 'Прикрепить загруженные файлы к документу (страницы/стороны)' })
  attachFiles(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: DocumentFilesDto,
  ) {
    return this.documents.attachFiles(user, id, dto)
  }

  @Patch(':id/files/order')
  @ApiOperation({ summary: 'Изменить порядок страниц' })
  reorderFiles(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: DocumentFilesDto,
  ) {
    return this.documents.reorderFiles(user, id, dto)
  }

  @Get(':id/files/:fileId/url')
  @ApiOperation({ summary: 'Presigned-URL к файлу документа (открыть/скачать)' })
  @ApiQuery({
    name: 'download',
    required: false,
    description:
      'При `1` ссылка отдаёт файл вложением (Content-Disposition), а не открывает его в браузере',
  })
  fileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('download') download?: string,
  ) {
    return this.documents.getFileUrl(user, id, fileId, download === '1').then((url) => ({ url }))
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'История действий по документу' })
  events(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.listEvents(user, id)
  }

  @Get(':id/access')
  @ApiOperation({ summary: 'Кому предоставлен доступ к документу' })
  listAccess(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.listAccess(user, id)
  }

  @Post(':id/access')
  @ApiOperation({ summary: 'Предоставить доступ (университету/подразделению/пользователю)' })
  grantAccess(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: GrantAccessDto,
  ) {
    return this.documents.grantAccess(user, id, dto)
  }

  @Delete(':id/access/:accessId')
  @ApiOperation({ summary: 'Отозвать доступ' })
  revokeAccess(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
  ) {
    return this.documents.revokeAccess(user, id, accessId)
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Переместить документ в архив' })
  archive(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.setArchived(user, id, true)
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Вернуть документ из архива' })
  unarchive(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.setArchived(user, id, false)
  }

  @Get(':id/platform')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Спец-режим: метаданные чужого документа (платформенный админ, с аудитом)',
  })
  platformGet(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.documents.platformGet(user, id)
  }

  @Post(':id/platform-access')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({
    summary: 'Спец-режим: presigned-URL к файлу с обязательной причиной (аудит + журнал)',
  })
  platformFileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PlatformAccessDto,
  ) {
    return this.documents.platformFileUrl(user, id, dto.fileId, dto.reason).then((url) => ({ url }))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить документ (мягко)' })
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string): Promise<void> {
    await this.documents.remove(user, id)
  }
}
