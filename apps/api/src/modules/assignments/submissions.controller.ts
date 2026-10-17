import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { AssignmentsService } from './assignments.service'
import { GradeSubmissionDto } from './dto/grade-submission.dto'
import { ReturnSubmissionDto } from './dto/return-submission.dto'

const TEACH_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const

@ApiTags('Задания: проверка')
@ApiBearerAuth()
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly assignments: AssignmentsService) {}

  // Без @Roles: ссылку получает и автор работы, и тот, кто её проверяет, — права решает
  // сервис (студенту — только своя сдача, персоналу — тот же круг, что у списка сдач).
  @Get(':id/files/:fileId/presigned')
  @ApiOperation({ summary: 'Ссылка на файл работы (автор или проверяющий)' })
  @ApiResponse({ status: 200, description: '{ url, expiresAt } — скачивание с исходным именем' })
  fileUrl(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.assignments.getSubmissionFileUrl(user, id, fileId)
  }

  @Post(':id/grade')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Поставить балл (сданной работе) или переоценить (оценённой)' })
  @ApiResponse({ status: 409, description: 'CONFLICT — работа не на проверке или её уже изменили' })
  grade(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: GradeSubmissionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.assignments.grade(user, id, dto, this.ctx(req))
  }

  @Post(':id/return')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Вернуть сданную работу на исправление' })
  @ApiResponse({ status: 409, description: 'CONFLICT — работа не на проверке или её уже изменили' })
  returnForFix(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ReturnSubmissionDto,
    @Req() req: FastifyRequest,
  ) {
    return this.assignments.returnForFix(user, id, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
