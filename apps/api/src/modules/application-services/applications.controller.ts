import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { ApplicationsService } from './applications.service'
import { ApplicationDocumentsService } from './application-documents.service'
import { ApplicationProcessService } from './application-process.service'
import { CreateDraftDto } from './dto/create-draft.dto'
import { UpdateDraftDto } from './dto/update-draft.dto'
import { CancelApplicationDto } from './dto/cancel-application.dto'
import { ApplicationQueryDto } from './dto/application-query.dto'
import { AttachDocumentDto } from './dto/attach-document.dto'
import { RequestReplacementDto } from './dto/request-replacement.dto'
import { AssignApplicationDto } from './dto/assign-application.dto'
import { RejectApplicationDto } from './dto/reject-application.dto'
import { RequestCorrectionDto } from './dto/request-correction.dto'
import { AddResultDto } from './dto/add-result.dto'
import { MarkReadyDto } from './dto/mark-ready.dto'

// Заявки на услуги университета. Права/scope — в ApplicationsService через ApplicationPolicy
// (единый источник, §21/§25). Business-actions вместо generic PATCH /status (§39).
@ApiTags('Заявки')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly documents: ApplicationDocumentsService,
    private readonly process: ApplicationProcessService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Создать черновик заявки на услугу' })
  createDraft(@CurrentUser() user: CurrentUserData, @Body() dto: CreateDraftDto) {
    return this.applications.createDraft(user, dto.serviceId)
  }

  @Get('queue-stats')
  @ApiOperation({
    summary: 'Счётчики очереди сотрудника по scope (новые/в работе/готовы/просрочены)',
  })
  queueStats(@CurrentUser() user: CurrentUserData) {
    return this.process.queueStats(user)
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

  // ── Обработка сотрудником (§15–§17, §39) ────────────────────────────────────
  @Post(':id/take')
  @ApiOperation({
    summary: 'Взять в работу (SUBMITTED/RESUBMITTED → IN_REVIEW, назначить на себя)',
  })
  take(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.process.take(user, id)
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Назначить ответственного сотрудника' })
  assign(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AssignApplicationDto,
  ) {
    return this.process.assign(user, id, dto.userId)
  }

  @Post(':id/request-correction')
  @ApiOperation({ summary: 'Запросить исправление (IN_REVIEW → NEEDS_CORRECTION)' })
  requestCorrection(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RequestCorrectionDto,
  ) {
    return this.process.requestCorrection(user, id, dto.comment)
  }

  @Post(':id/start-preparation')
  @ApiOperation({ summary: 'Начать подготовку (IN_REVIEW → IN_PREPARATION)' })
  startPreparation(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.process.startPreparation(user, id)
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Отклонить заявку с причиной' })
  reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.process.reject(user, id, dto.reason)
  }

  @Post(':id/results')
  @ApiOperation({ summary: 'Добавить результат (на этапе подготовки)' })
  addResult(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AddResultDto,
  ) {
    return this.process.addResult(user, id, dto)
  }

  @Post(':id/mark-ready')
  @ApiOperation({ summary: 'Пометить готовым (IN_PREPARATION → READY / READY_FOR_PICKUP)' })
  markReady(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: MarkReadyDto,
  ) {
    return this.process.markReady(user, id, dto)
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Выдать оригинал (READY_FOR_PICKUP → ISSUED)' })
  issue(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.process.issue(user, id)
  }

  @Post(':id/deliver')
  @ApiOperation({ summary: 'Отметить электронный результат предоставленным (READY → DELIVERED)' })
  deliver(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.process.deliver(user, id)
  }
}
