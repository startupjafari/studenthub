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
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { Scope } from '../../common/decorators/scope.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { FacultyService } from './faculties.service'
import { CreateFacultyDto } from './dto/create-faculty.dto'
import { UpdateFacultyDto } from './dto/update-faculty.dto'
import { FacultyListQueryDto } from './dto/faculty-list-query.dto'

@ApiTags('Факультеты')
@Controller('faculties')
export class FacultiesController {
  constructor(private readonly faculties: FacultyService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @Scope({ level: 'university', source: 'body', param: 'universityId' })
  @ApiOperation({ summary: 'Создать факультет (свой вуз для UNIVERSITY_ADMIN)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateFacultyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.faculties.create(user, dto, this.ctx(req))
  }

  @Get()
  @ApiOperation({ summary: 'Список факультетов (платформа — любые, иначе свой вуз)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: FacultyListQueryDto) {
    return this.faculties.list(user, query.page, query.limit, query.universityId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Факультет (scope)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.faculties.getById(user, id)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Переименовать факультет' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateFacultyDto,
    @Req() req: FastifyRequest,
  ) {
    return this.faculties.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить факультет (только без групп)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.faculties.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
