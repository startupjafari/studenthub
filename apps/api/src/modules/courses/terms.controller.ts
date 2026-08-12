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
import { CreateTermDto } from './dto/create-term.dto'
import { UpdateTermDto } from './dto/update-term.dto'
import { TermListQueryDto } from './dto/term-list-query.dto'

const MANAGE_ROLES = [Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN] as const

@ApiTags('Дисциплины: семестры')
@ApiBearerAuth()
@Controller('terms')
export class TermsController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ApiOperation({ summary: 'Семестры вуза' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: TermListQueryDto) {
    return this.courses.listTerms(user, query)
  }

  @Post()
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Создать семестр (админ вуза)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateTermDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.createTerm(user, dto, this.ctx(req))
  }

  @Patch(':id')
  @Roles(...MANAGE_ROLES)
  @ApiOperation({ summary: 'Изменить семестр (админ вуза)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateTermDto,
    @Req() req: FastifyRequest,
  ) {
    return this.courses.updateTerm(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(...MANAGE_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить семестр (админ вуза)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.courses.deleteTerm(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
