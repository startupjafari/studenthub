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
  Put,
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
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import { AppException } from '../../common/exceptions/app.exception'
import { readUploadWithFields } from '../../common/http/read-upload'
import type { RequestContext } from '../auth/auth.service'
import { AssignmentsService } from './assignments.service'
import { CreateAssignmentDto } from './dto/create-assignment.dto'
import { UpdateAssignmentDto } from './dto/update-assignment.dto'
import { AssignmentListQueryDto } from './dto/assignment-list-query.dto'
import { ReviewQueueQueryDto } from './dto/review-queue-query.dto'
import { SaveSubmissionDto } from './dto/save-submission.dto'
import { ConfirmSubmissionFileDto, PresignSubmissionFileDto } from './dto/submission-file.dto'

const TEACH_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const
const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const

@ApiTags('Задания')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Задания по scope (студент — опубликованные своей группы + своя сдача)',
  })
  list(@CurrentUser() user: CurrentUserData, @Query() query: AssignmentListQueryDto) {
    return this.assignments.list(user, query)
  }

  @Get('review-queue')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Очередь проверки: сколько работ сдано и по каким заданиям' })
  @ApiResponse({ status: 200, description: '{ total, items[] }' })
  reviewQueue(@CurrentUser() user: CurrentUserData, @Query() query: ReviewQueueQueryDto) {
    return this.assignments.reviewQueue(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Задание (детали + своя сдача у студента)' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.assignments.getById(user, id)
  }

  @Get(':id/submissions')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Сдачи задания (workspace проверки)' })
  submissions(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.assignments.submissions(user, id)
  }

  @Post()
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Создать задание (преподаватель своей дисциплины)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateAssignmentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.assignments.create(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Изменить задание' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
    @Req() req: FastifyRequest,
  ) {
    return this.assignments.update(user, id, dto, this.ctx(req))
  }

  @Post(':id/publish')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Опубликовать задание' })
  publish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.assignments.setStatus(user, id, 'PUBLISHED', this.ctx(req))
  }

  @Post(':id/close')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Закрыть задание' })
  close(@CurrentUser() user: CurrentUserData, @Param('id') id: string, @Req() req: FastifyRequest) {
    return this.assignments.setStatus(user, id, 'CLOSED', this.ctx(req))
  }

  @Delete(':id')
  @Roles(...TEACH_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить задание' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.assignments.remove(user, id, this.ctx(req))
  }

  // ── Сдача (студент) ─────────────────────────────────────────────────────

  @Put(':id/submission')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Сохранить черновик работы' })
  saveDraft(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: SaveSubmissionDto,
  ) {
    return this.assignments.saveDraft(user, id, dto)
  }

  @Post(':id/submit')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Отправить работу на проверку' })
  submit(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.assignments.submit(user, id)
  }

  // ── Файлы сдачи (студент) ───────────────────────────────────────────────
  // Как у материалов: до порога — буферная загрузка, больше — presign → PUT → confirm.
  // Файл сразу попадает в черновик сдачи (черновика нет — он создаётся).

  @Post(':id/submission/files')
  @Roles(...STUDENT_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Приложить файл к работе (до порога буферной загрузки)' })
  @ApiResponse({ status: 201, description: '{ id, name, mime, size, createdAt }' })
  @ApiResponse({ status: 409, description: 'CONFLICT — работа отправлена или файлов уже 10' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  async addSubmissionFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    // С полями, а не readSingleUpload: нужно исходное имя файла — по нему преподаватель
    // отличает отчёт от исходников.
    const { files } = await readUploadWithFields(req)
    const file = files[0]
    if (!file) {
      throw new AppException('BAD_REQUEST', 'Файл не передан (ожидается multipart-поле "file")')
    }
    return this.assignments.addSubmissionFile(user, id, {
      buffer: file.buffer,
      name: file.filename || undefined,
    })
  }

  @Post(':id/submission/files/presign')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Прямая загрузка файла работы: подписанная ссылка (шаг 1 из 3)' })
  @ApiResponse({ status: 201, description: 'key + PUT-URL + срок действия' })
  presignSubmissionFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: PresignSubmissionFileDto,
  ) {
    return this.assignments.presignSubmissionFile(user, id, dto.mime)
  }

  @Post(':id/submission/files/confirm')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Подтвердить прямую загрузку файла работы (шаг 3 из 3)' })
  @ApiResponse({ status: 201, description: '{ id, name, mime, size, createdAt }' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — ключ не принадлежит вызывающему' })
  @ApiResponse({ status: 422, description: 'FILE_TYPE_NOT_ALLOWED / FILE_TOO_LARGE' })
  confirmSubmissionFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ConfirmSubmissionFileDto,
  ) {
    return this.assignments.confirmSubmissionFile(user, id, dto.key, dto.name)
  }

  @Delete(':id/submission/files/:fileId')
  @Roles(...STUDENT_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать файл из неотправленной работы' })
  @ApiResponse({ status: 409, description: 'CONFLICT — работа уже отправлена' })
  async removeSubmissionFile(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    await this.assignments.removeSubmissionFile(user, id, fileId)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
