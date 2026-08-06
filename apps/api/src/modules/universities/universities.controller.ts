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
import { UniversityService } from './universities.service'
import { CreateUniversityDto } from './dto/create-university.dto'
import { UpdateUniversityDto } from './dto/update-university.dto'
import { UpdateUniversityStatusDto } from './dto/update-status.dto'
import { OffsetPaginationDto } from './dto/offset-pagination.dto'

@ApiTags('Университеты')
@Controller('universities')
export class UniversitiesController {
  constructor(private readonly universities: UniversityService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Создать университет (PLATFORM_ADMIN)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateUniversityDto,
    @Req() req: FastifyRequest,
  ) {
    return this.universities.create(user, dto, this.ctx(req))
  }

  @Get()
  @Roles(Role.PLATFORM_ADMIN, Role.PLATFORM_MODERATOR)
  @ApiOperation({ summary: 'Список университетов (платформа)' })
  list(@Query() query: OffsetPaginationDto) {
    return this.universities.list(query.page, query.limit)
  }

  @Get(':id')
  @Scope({ level: 'university', param: 'id' })
  @ApiOperation({ summary: 'Профиль вуза (платформа — любой, иначе свой)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.universities.getById(user, id)
  }

  @Get(':id/stats')
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.PLATFORM_MODERATOR,
    Role.UNIVERSITY_ADMIN,
    Role.UNIVERSITY_MODERATOR,
  )
  @Scope({ level: 'university', param: 'id' })
  @ApiOperation({ summary: 'Статистика вуза (кэш 5 мин)' })
  stats(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.universities.getStats(user, id)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Обновить реквизиты вуза (PLATFORM_ADMIN)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateUniversityDto,
    @Req() req: FastifyRequest,
  ) {
    return this.universities.update(user, id, dto, this.ctx(req))
  }

  @Patch(':id/status')
  @Roles(Role.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Сменить статус вуза (PLATFORM_ADMIN)' })
  setStatus(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateUniversityStatusDto,
    @Req() req: FastifyRequest,
  ) {
    return this.universities.setStatus(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить вуз (только пустой)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.universities.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
