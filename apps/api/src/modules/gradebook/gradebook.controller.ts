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
  Req,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { GradebookService } from './gradebook.service'
import { CreateGradeColumnDto } from './dto/create-grade-column.dto'
import { UpdateGradeColumnDto } from './dto/update-grade-column.dto'
import { SaveGradesDto } from './dto/save-grades.dto'

const TEACH_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN, Role.TEACHER] as const
const STUDENT_ROLES = [Role.STUDENT, Role.STAROSTA] as const

@ApiTags('Журнал оценок')
@ApiBearerAuth()
@Controller('gradebook')
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get('me')
  @Roles(...STUDENT_ROLES)
  @ApiOperation({ summary: 'Мои оценки по дисциплинам (только опубликованные)' })
  me(@CurrentUser() user: CurrentUserData) {
    return this.gradebook.myGrades(user)
  }

  @Get('course/:courseId')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Журнал дисциплины (колонки + студенты + оценки)' })
  courseGradebook(@CurrentUser() user: CurrentUserData, @Param('courseId') courseId: string) {
    return this.gradebook.gradebook(user, courseId)
  }

  @Post('columns')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Добавить контрольную точку' })
  createColumn(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateGradeColumnDto,
    @Req() req: FastifyRequest,
  ) {
    return this.gradebook.createColumn(user, dto, this.ctx(req))
  }

  @Patch('columns/:id')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Изменить контрольную точку' })
  updateColumn(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateGradeColumnDto,
    @Req() req: FastifyRequest,
  ) {
    return this.gradebook.updateColumn(user, id, dto, this.ctx(req))
  }

  @Post('columns/:id/publish')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Опубликовать оценки колонки' })
  publish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.gradebook.setPublished(user, id, true, this.ctx(req))
  }

  @Post('columns/:id/unpublish')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Снять с публикации (черновик)' })
  unpublish(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.gradebook.setPublished(user, id, false, this.ctx(req))
  }

  @Delete('columns/:id')
  @Roles(...TEACH_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить контрольную точку' })
  async removeColumn(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.gradebook.deleteColumn(user, id, this.ctx(req))
  }

  @Put('grades')
  @Roles(...TEACH_ROLES)
  @ApiOperation({ summary: 'Сохранить оценки колонки (массово)' })
  saveGrades(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: SaveGradesDto,
    @Req() req: FastifyRequest,
  ) {
    return this.gradebook.saveGrades(user, dto, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
