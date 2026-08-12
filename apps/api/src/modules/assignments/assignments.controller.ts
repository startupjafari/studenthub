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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { AssignmentsService } from './assignments.service'
import { CreateAssignmentDto } from './dto/create-assignment.dto'
import { UpdateAssignmentDto } from './dto/update-assignment.dto'
import { AssignmentListQueryDto } from './dto/assignment-list-query.dto'
import { SaveSubmissionDto } from './dto/save-submission.dto'

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

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
