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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { CoursesService } from './courses.service'
import { CreateSubjectDto } from './dto/create-subject.dto'
import { UpdateSubjectDto } from './dto/update-subject.dto'
import { SubjectListQueryDto } from './dto/subject-list-query.dto'

const MANAGE_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN] as const

@ApiTags('Дисциплины: справочник')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Справочник дисциплин вуза' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: SubjectListQueryDto) {
    return this.courses.listSubjects(user, query)
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Создать дисциплину (админ вуза)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateSubjectDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.createSubject(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Изменить дисциплину (админ вуза)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.updateSubject(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить дисциплину (админ вуза)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.courses.deleteSubject(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
