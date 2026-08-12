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
import { CreateCourseDto } from './dto/create-course.dto'
import { UpdateCourseDto } from './dto/update-course.dto'
import { CourseListQueryDto } from './dto/course-list-query.dto'

const MANAGE_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN] as const

@ApiTags('Дисциплины')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Дисциплины по scope (студент — своя группа)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: CourseListQueryDto) {
    return this.courses.listCourses(user, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Дисциплина (по scope)' })
  get(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.courses.getCourse(user, id)
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Назначить дисциплину группе (декан/админ вуза)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCourseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.createCourse(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Изменить дисциплину (декан/админ вуза)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.updateCourse(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить дисциплину (декан/админ вуза)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.courses.deleteCourse(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
