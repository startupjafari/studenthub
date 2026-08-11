import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ApplicationsService } from './applications.service'
import { ApplicationDocumentsService } from './application-documents.service'
import { CreateDraftDto } from './dto/create-draft.dto'
import { UpdateDraftDto } from './dto/update-draft.dto'
import { CancelApplicationDto } from './dto/cancel-application.dto'
import { ApplicationQueryDto } from './dto/application-query.dto'
import { AttachDocumentDto } from './dto/attach-document.dto'
import { RequestReplacementDto } from './dto/request-replacement.dto'

// Заявки на услуги университета. Права/scope — в ApplicationsService через ApplicationPolicy
// (единый источник, §21/§25). Business-actions вместо generic PATCH /status (§39).
@ApiTags('Заявки')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly documents: ApplicationDocumentsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Создать черновик заявки на услугу' })
  createDraft(@CurrentUser() user: CurrentUserData, @Body() dto: CreateDraftDto) {
    return this.applications.createDraft(user, dto.serviceId)
  }

  @Get()
  @ApiOperation({ summary: 'Список/очередь заявок по scope роли (пагинация + фильтры)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ApplicationQueryDto) {
    return this.applications.list(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Заявка: детали, услуга, timeline' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.applications.getById(user, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Правка черновика (способ получения + форма)' })
  updateDraft(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.applications.updateDraft(user, id, dto)
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Отправить заявку (DRAFT → SUBMITTED): номер + срок по SLA' })
  submit(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.applications.submit(user, id)
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Отозвать заявку (→ CANCELLED)' })
  cancel(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CancelApplicationDto,
  ) {
    return this.applications.cancel(user, id, dto.reason)
  }

  @Post(':id/resubmit')
  @ApiOperation({
    summary: 'Повторно отправить после исправления (NEEDS_CORRECTION → RESUBMITTED)',
  })
  resubmit(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.applications.resubmit(user, id)
  }

  // ── Документы заявки (§3/§4) ────────────────────────────────────────────────
  @Post(':id/documents')
  @ApiOperation({ summary: 'Приложить документ из хранилища к требованию (или заменить)' })
  attachDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AttachDocumentDto,
  ) {
    return this.documents.attach(user, id, dto.requirementId, dto.documentId)
  }

  @Delete(':id/documents/:requirementId')
  @ApiOperation({ summary: 'Убрать приложенный документ (владелец, до/во время исправления)' })
  removeDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('requirementId') requirementId: string,
  ) {
    return this.documents.remove(user, id, requirementId)
  }

  @Post(':id/documents/:docId/accept')
  @ApiOperation({ summary: 'Принять документ (сотрудник)' })
  acceptDocument(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.documents.review(user, id, docId, 'accept')
  }

  @Post(':id/documents/:docId/request-replacement')
  @ApiOperation({ summary: 'Запросить замену документа с причиной (сотрудник → NEEDS_CORRECTION)' })
  requestReplacement(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() dto: RequestReplacementDto,
  ) {
    return this.documents.review(user, id, docId, 'request-replacement', dto.comment)
  }

  @Get(':id/documents/:docId/url')
  @ApiOperation({ summary: 'Presigned-ссылка на файл документа заявки (владелец/обработчик)' })
  documentUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.documents.presignedUrl(user, id, docId)
  }
}
