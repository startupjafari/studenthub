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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Role } from '@studenthub/shared-types'
import type { FastifyRequest } from 'fastify'
import { Roles } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { CurrentUserData } from '../../common/auth/jwt-payload.type'
import type { RequestContext } from '../auth/auth.service'
import { EventsService } from './events.service'
import { CreateEventDto } from './dto/create-event.dto'
import { UpdateEventDto } from './dto/update-event.dto'
import { EventListQueryDto } from './dto/event-list-query.dto'

// Создавать события могут все, кроме модераторов (docs/PROJECT.md §2.2).
const AUTHOR_ROLES = [
  Role.PLATFORM_ADMIN,
  Role.UNIVERSITY_ADMIN,
  Role.DEAN,
  Role.TEACHER,
  Role.STAROSTA,
  Role.STUDENT,
] as const

@ApiTags('События')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'События по видимости (upcoming/past, only mine)' })
  @ApiResponse({ status: 200, description: 'Страница событий' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: EventListQueryDto) {
    return this.events.list(user, query)
  }

  @Post()
  @Roles(...AUTHOR_ROLES)
  @ApiOperation({ summary: 'Создать событие (аудитория ограничена ролью)' })
  @ApiResponse({ status: 201, description: 'Событие создано' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateEventDto,
    @Req() req: FastifyRequest,
  ) {
    return this.events.create(user, dto, this.ctx(req))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Событие (если видимо)' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND / не видимо' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.getById(user, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить событие (организатор или админ scope)' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: FastifyRequest,
  ) {
    return this.events.update(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить событие (организатор или админ scope)' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.events.remove(user, id, this.ctx(req))
  }

  @Post(':id/register')
  @ApiOperation({ summary: 'Зарегистрироваться на событие' })
  @ApiResponse({ status: 201, description: 'Зарегистрирован' })
  register(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.register(user, id)
  }

  @Delete(':id/register')
  @ApiOperation({ summary: 'Отменить регистрацию' })
  @ApiResponse({ status: 200, description: 'Регистрация отменена' })
  cancel(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.cancelRegistration(user, id)
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'Участники события (организатор/админ)' })
  @ApiResponse({ status: 200, description: 'Список участников' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN' })
  participants(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.events.listParticipants(user, id)
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
