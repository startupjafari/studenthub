import { Body, Controller, Get, Param, Post, Put, Patch, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { DocumentRequestsService } from './document-requests.service'
import {
  CreateDocumentRequestDto,
  ReviewSubmissionItemDto,
  SaveSubmissionDto,
} from './dto/document-request.dto'
import { SharedWithMeQueryDto } from './dto/shared-with-me-query.dto'

// Сотрудники запросов (§15.2): деканат, модератор вуза, преподаватель. Сервис дополнительно
// сужает область — свои запросы и запросы подразделения.
const STAFF = [Role.DEAN, Role.UNIVERSITY_MODERATOR, Role.TEACHER] as const
// Отвечают на запросы только студенты и старосты: прочим ролям «запросы на весь вуз»
// раньше тоже открывались и принимали ответ (D-F25).
const RESPONDERS = [Role.STUDENT, Role.STAROSTA] as const

// Запросы вуза на документы (Ф15C). Статические маршруты объявлены до параметрических (`:id`).
@ApiTags('Документы: запросы')
@ApiBearerAuth()
@Controller('document-requests')
export class DocumentRequestsController {
  constructor(private readonly requests: DocumentRequestsService) {}

  // ── Сотрудник ───────────────────────────────────────────────────────────────

  @Post()
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Создать запрос документов (сотрудник)' })
  create(@CurrentUser() user: CurrentUserData, @Body() dto: CreateDocumentRequestDto) {
    return this.requests.createRequest(user, dto)
  }

  @Get('authored')
  @Roles(...STAFF)
  @ApiOperation({
    summary:
      'Запросы в моей области (сотрудник): свои и подразделения; mine/authorName — чей запрос',
  })
  listAuthored(@CurrentUser() user: CurrentUserData) {
    return this.requests.listAuthored(user)
  }

  @Get('manage/:id')
  @Roles(...STAFF)
  @ApiOperation({
    summary:
      'Запрос с комплектами для проверки (сотрудник): первые 200 комплектов, всего — submissionCount',
  })
  manage(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.getRequestForStaff(user, id)
  }

  @Get('manage/:id/submissions')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Комплекты запроса постранично (сотрудник)' })
  @ApiResponse({ status: 200, description: 'Комплекты; meta.cursor/hasNext' })
  manageSubmissions(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Query() query: SharedWithMeQueryDto,
  ) {
    return this.requests.listSubmissionsForStaff(user, id, query)
  }

  @Post('manage/:id/close')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Закрыть запрос: ответы больше не принимаются (сотрудник)' })
  close(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.closeRequest(user, id)
  }

  @Get('submissions/:submissionId')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Комплект студента для проверки (сотрудник)' })
  submission(@CurrentUser() user: CurrentUserData, @Param('submissionId') submissionId: string) {
    return this.requests.getSubmissionForStaff(user, submissionId)
  }

  @Get('submission-items/:itemId/files/:fileId/url')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Presigned-URL приложенного файла (проверяющий сотрудник)' })
  submissionFileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId') itemId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.requests.getSubmissionFileUrl(user, itemId, fileId).then((url) => ({ url }))
  }

  @Patch('submission-items/:itemId/review')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Проверить позицию комплекта: принять/отклонить (сотрудник)' })
  reviewItem(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId') itemId: string,
    @Body() dto: ReviewSubmissionItemDto,
  ) {
    return this.requests.reviewItem(user, itemId, dto)
  }

  @Post('submissions/:submissionId/finalize')
  @Roles(...STAFF)
  @ApiOperation({ summary: 'Завершить проверку комплекта (сотрудник)' })
  finalize(@CurrentUser() user: CurrentUserData, @Param('submissionId') submissionId: string) {
    return this.requests.finalizeSubmission(user, submissionId)
  }

  // ── Студент ───────────────────────────────────────────────────────────────

  @Get()
  @Roles(...RESPONDERS)
  @ApiOperation({ summary: 'Запросы, адресованные мне (студент)' })
  listForStudent(@CurrentUser() user: CurrentUserData) {
    return this.requests.listForStudent(user)
  }

  @Get(':id')
  @Roles(...RESPONDERS)
  @ApiOperation({ summary: 'Запрос с чек-листом и моим ответом (студент)' })
  getForStudent(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.getForStudent(user, id)
  }

  @Put(':id/submission')
  @Roles(...RESPONDERS)
  @ApiOperation({ summary: 'Сохранить черновик ответа (студент)' })
  save(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SaveSubmissionDto,
  ) {
    return this.requests.saveSubmission(user, id, dto)
  }

  @Post(':id/submit')
  @Roles(...RESPONDERS)
  @ApiOperation({ summary: 'Отправить комплект на проверку (студент)' })
  submit(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.requests.submitSubmission(user, id)
  }
}
