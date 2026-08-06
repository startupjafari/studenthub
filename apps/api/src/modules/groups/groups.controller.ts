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
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { GroupService } from './groups.service'
import { CreateGroupDto } from './dto/create-group.dto'
import { UpdateGroupDto } from './dto/update-group.dto'
import { AssignStarostaDto } from './dto/assign-starosta.dto'
import { GroupListQueryDto } from './dto/group-list-query.dto'

@ApiTags('Группы')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Создать группу (свой вуз для UNIVERSITY_ADMIN)' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateGroupDto,
    @Req() req: FastifyRequest,
  ) {
    return this.groups.create(user, dto, this.ctx(req))
  }

  @Get()
  @ApiOperation({ summary: 'Список групп (по scope смотрящего)' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: GroupListQueryDto) {
    return this.groups.list(user, query.page, query.limit, query.facultyId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Группа (scope)' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.groups.getById(user, id)
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Участники группы (без личных данных)' })
  members(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.groups.members(user, id)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @ApiOperation({ summary: 'Обновить группу (название/год)' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: FastifyRequest,
  ) {
    return this.groups.update(user, id, dto, this.ctx(req))
  }

  @Patch(':id/starosta')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @ApiOperation({ summary: 'Назначить/снять старосту (участника группы)' })
  assignStarosta(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: AssignStarostaDto,
    @Req() req: FastifyRequest,
  ) {
    return this.groups.assignStarosta(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить группу (только без студентов)' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.groups.remove(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
