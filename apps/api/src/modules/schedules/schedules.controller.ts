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
import { SchedulesService } from './schedules.service'
import { CreateScheduleDto } from './dto/create-schedule.dto'
import { UpdateScheduleDto } from './dto/update-schedule.dto'
import { ScheduleListQueryDto } from './dto/schedule-list-query.dto'

// Контейнеры расписания (задача 6.4). Управление — декан/админ; чтение — по scope роли.
@ApiTags('Расписание')
@ApiBearerAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post()
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @ApiOperation({ summary: 'Создать контейнер расписания для группы' })
  @ApiResponse({ status: 201, description: 'Расписание создано' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / WRONG_SCOPE' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateScheduleDto,
    @Req() req: FastifyRequest,
  ) {
    return this.schedules.createSchedule(user, dto, this.ctx(req))
  }

  @Get()
  @ApiOperation({ summary: 'Список контейнеров расписания (по scope, фильтр по группе)' })
  @ApiResponse({ status: 200, description: 'Контейнеры расписания' })
  list(@CurrentUser() user: CurrentUserData, @Query() query: ScheduleListQueryDto) {
    return this.schedules.listSchedules(user, query.groupId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Контейнер расписания с парами (scope)' })
  @ApiResponse({ status: 200, description: 'Расписание + пары + таймзона' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND' })
  getById(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.schedules.getScheduleById(user, id)
  }

  @Patch(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @ApiOperation({ summary: 'Обновить контейнер (название/активность)' })
  @ApiResponse({ status: 200, description: 'Обновлено' })
  @ApiResponse({ status: 403, description: 'WRONG_SCOPE' })
  update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
    @Req() req: FastifyRequest,
  ) {
    return this.schedules.updateSchedule(user, id, dto, this.ctx(req))
  }

  @Delete(':id')
  @Roles(Role.PLATFORM_ADMIN, Role.UNIVERSITY_ADMIN, Role.DEAN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить контейнер (пары удаляются каскадом)' })
  @ApiResponse({ status: 204, description: 'Удалено' })
  async remove(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.schedules.removeSchedule(user, id, this.ctx(req))
  }

  private ctx(req: FastifyRequest): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }
}
