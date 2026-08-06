import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { DocumentRequestsService } from './document-requests.service'
import {
  CreateDocumentRequestDto,
  ReviewSubmissionItemDto,
  SaveSubmissionDto,
} from './dto/document-request.dto'

// Запросы вуза на документы (Ф15C). Статические маршруты объявлены до параметрических (`:id`).
@ApiTags('Документы: запросы')
@ApiBearerAuth()
@Controller('document-requests')
export class DocumentRequestsController {
  constructor(private readonly requests: DocumentRequestsService) {}

  // ── Сотрудник ───────────────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Создать запрос документов (сотрудник)' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateDocumentRequestDto) {
    return this.requests.createRequest(user, dto)
  }

  @Get('authored')
  @ApiOperation({ summary: 'Мои созданные запросы (сотрудник)' })
  listAuthored(@CurrentUser() user: CurrentUserData) {
    return this.requests.listAuthored(user)
  }

  @Get('manage/:id')
  @ApiOperation({ summary: 'Запрос с комплектами для проверки (сотрудник)' })
  manage(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.getRequestForStaff(user, id)
  }

  @Get('submissions/:submissionId')
  @ApiOperation({ summary: 'Комплект студента для проверки (сотрудник)' })
  submission(@CurrentUser() user: CurrentUserData, @Param('submissionId') submissionId: string) {
    return this.requests.getSubmissionForStaff(user, submissionId)
  }

  @Get('submission-items/:itemId/files/:fileId/url')
  @ApiOperation({ summary: 'Presigned-URL приложенного файла (проверяющий сотрудник)' })
  submissionFileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId') itemId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.requests.getSubmissionFileUrl(user, itemId, fileId).then((url) => ({ url }))
  }

  @Patch('submission-items/:itemId/review')
  @ApiOperation({ summary: 'Проверить позицию комплекта: принять/отклонить (сотрудник)' })
  reviewItem(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId') itemId: string,
    @Body() dto: ReviewSubmissionItemDto,
  ) {
    return this.requests.reviewItem(user, itemId, dto)
  }

  @Post('submissions/:submissionId/finalize')
  @ApiOperation({ summary: 'Завершить проверку комплекта (сотрудник)' })
  finalize(@CurrentUser() user: CurrentUserData, @Param('submissionId') submissionId: string) {
    return this.requests.finalizeSubmission(user, submissionId)
  }

  // ── Студент ───────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Запросы, адресованные мне (студент)' })
  listForStudent(@CurrentUser() user: CurrentUserData) {
    return this.requests.listForStudent(user)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Запрос с чек-листом и моим ответом (студент)' })
  getForStudent(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.getForStudent(user, id)
  }

  @Put(':id/submission')
  @ApiOperation({ summary: 'Сохранить черновик ответа (студент)' })
  save(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SaveSubmissionDto,
  ) {
    return this.requests.saveSubmission(user, id, dto)
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Отправить комплект на проверку (студент)' })
  submit(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.submitSubmission(user, id)
  }
}
