import { Body, Controller, Param, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
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

  @Post(':id/grade')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Поставить балл и опубликовать результат' })
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
  @ApiOperation({ summary: 'Вернуть работу на исправление' })
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
